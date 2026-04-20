package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// S3 is a backup backend targeting AWS S3 or any S3-compatible service
// (MinIO, Backblaze B2, Cloudflare R2, Wasabi, etc.).
//
// The client is constructed with explicit static credentials — we never
// fall back to the ambient AWS SDK credential chain, so a misconfigured
// destination can't silently pick up EC2 instance profile creds or a stale
// ~/.aws/credentials file.
type S3 struct {
	client   *s3.Client
	uploader *manager.Uploader
	bucket   string
	prefix   string
}

// S3Options bundles the user-supplied configuration so the factory (and
// tests) don't have to know about the AWS SDK types.
type S3Options struct {
	Bucket          string
	Region          string
	Prefix          string // may be empty
	AccessKeyID     string
	SecretAccessKey string
	EndpointURL     string // empty = AWS
	UsePathStyle    bool
}

// NewS3 constructs an S3 backend. Validates the required fields locally so
// the error surfaces at destination-create time rather than first upload.
func NewS3(opts S3Options) (*S3, error) {
	if opts.Bucket == "" {
		return nil, fmt.Errorf("s3 bucket is required")
	}
	if opts.AccessKeyID == "" || opts.SecretAccessKey == "" {
		return nil, fmt.Errorf("s3 access key id and secret access key are required")
	}
	// Default region to us-east-1 when unset — AWS still requires a region
	// in the signer even when the endpoint is fully specified (MinIO etc.).
	region := opts.Region
	if region == "" {
		region = "us-east-1"
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			opts.AccessKeyID, opts.SecretAccessKey, "",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}

	clientOpts := []func(*s3.Options){}
	if opts.EndpointURL != "" {
		endpoint := opts.EndpointURL
		clientOpts = append(clientOpts, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(endpoint)
		})
	}
	if opts.UsePathStyle {
		clientOpts = append(clientOpts, func(o *s3.Options) {
			o.UsePathStyle = true
		})
	}
	client := s3.NewFromConfig(cfg, clientOpts...)

	return &S3{
		client:   client,
		uploader: manager.NewUploader(client),
		bucket:   opts.Bucket,
		prefix:   strings.Trim(opts.Prefix, "/"),
	}, nil
}

// key assembles the full S3 key from the user-configured prefix and the
// backup filename. filepath.Base is used to guard against a filename with
// embedded slashes escaping into a different prefix.
func (s *S3) key(filename string) string {
	name := path.Base(filename)
	if s.prefix == "" {
		return name
	}
	return s.prefix + "/" + name
}

func (s *S3) Upload(ctx context.Context, filename string, r io.Reader, size int64) error {
	_, err := s.uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.key(filename)),
		Body:   r,
	})
	if err != nil {
		return fmt.Errorf("s3 upload: %w", err)
	}
	return nil
}

func (s *S3) Download(ctx context.Context, filename string) (io.ReadCloser, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.key(filename)),
	})
	if err != nil {
		var nsk *s3types.NoSuchKey
		if errors.As(err, &nsk) {
			return nil, fmt.Errorf("backup %q not found", filename)
		}
		return nil, fmt.Errorf("s3 download: %w", err)
	}
	return out.Body, nil
}

func (s *S3) Delete(ctx context.Context, filename string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.key(filename)),
	})
	// S3's DeleteObject is idempotent — missing keys return a success-looking
	// response on AWS. S3-compatible services vary; treat NoSuchKey as OK.
	var nsk *s3types.NoSuchKey
	if errors.As(err, &nsk) {
		return nil
	}
	return err
}

func (s *S3) List(ctx context.Context) ([]ObjectInfo, error) {
	listPrefix := ""
	if s.prefix != "" {
		listPrefix = s.prefix + "/"
	}
	var out []ObjectInfo
	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(listPrefix),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("s3 list: %w", err)
		}
		for _, obj := range page.Contents {
			if obj.Key == nil {
				continue
			}
			name := path.Base(*obj.Key)
			if !IsBackupFilename(name) {
				continue
			}
			info := ObjectInfo{Name: name}
			if obj.Size != nil {
				info.Size = *obj.Size
			}
			if obj.LastModified != nil {
				info.Modified = *obj.LastModified
			}
			out = append(out, info)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Test performs a HEAD on the bucket to verify credentials + reachability.
// HeadBucket is the cheapest operation that also validates the ListBucket
// permission shape most IAM policies use.
func (s *S3) Test(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(s.bucket),
	})
	if err != nil {
		return fmt.Errorf("s3 test: %w", err)
	}
	return nil
}
