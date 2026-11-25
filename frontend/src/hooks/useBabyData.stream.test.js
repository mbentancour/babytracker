import http from "node:http";
import { describe, it, expect, vi, afterEach } from "vitest";
import { listenForChanges } from "./useBabyData";

// The other tests of listenForChanges speak to a stand-in for fetch. These go
// through the real one, over HTTP to a server that answers the way
// /api/events does, to hold the reader to how a stream actually behaves:
// headers sent, chunks decoded, a refusal renewed, the connection closed.
describe("listenForChanges over a real connection", () => {
  let server = null;
  let stop = () => {};

  afterEach(async () => {
    stop();
    stop = () => {};
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      server = null;
    }
  });

  // Starts a server whose every request to /api/events is handed to `answer`,
  // and returns a fetch that resolves the app's relative URL against it.
  const serve = async (answer) => {
    const requests = [];
    server = http.createServer((req, res) => {
      const request = { path: req.url, authorization: req.headers.authorization, accept: req.headers.accept, res, closed: false };
      res.on("close", () => { request.closed = true; });
      requests.push(request);
      answer(request, requests.length);
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${server.address().port}/`;
    return { requests, fetch: (url, init) => fetch(new URL(url, base), init) };
  };

  const openStream = ({ res }) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write('data: {"connected":true}\n\n');
  };

  it("reads the stream, refetches on a change and hangs up when stopped", async () => {
    const { requests, fetch: toServer } = await serve(openStream);
    const refetch = vi.fn();
    stop = listenForChanges(refetch, { current: 0 }, { fetch: toServer, getToken: () => "access-1", refresh: async () => "ok" });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].path).toBe("/api/events");
    expect(requests[0].authorization).toBe("Bearer access-1");
    expect(requests[0].accept).toBe("text/event-stream");

    // Being open is not news, and neither is a keep-alive line.
    requests[0].res.write(": keep-alive\n\n");
    await new Promise((done) => setTimeout(done, 500));
    expect(refetch).not.toHaveBeenCalled();

    requests[0].res.write('data: {"changed":true}\n\n');
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1), { timeout: 3000 });

    stop();
    await vi.waitFor(() => expect(requests[0].closed).toBe(true), { timeout: 3000 });
    expect(requests).toHaveLength(1);
  });

  it("renews a token the server no longer takes and listens with the new one", async () => {
    const { requests, fetch: toServer } = await serve((request) => {
      if (request.authorization !== "Bearer access-2") {
        request.res.writeHead(401, { "Content-Type": "application/json" });
        request.res.end('{"error":"authentication required"}');
        return;
      }
      openStream(request);
    });
    const refetch = vi.fn();
    let token = "access-1";
    const refresh = vi.fn(async () => {
      token = "access-2";
      return "ok";
    });
    stop = listenForChanges(refetch, { current: 0 }, { fetch: toServer, getToken: () => token, refresh });

    await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 3000 });
    expect(requests.map((r) => r.authorization)).toEqual(["Bearer access-1", "Bearer access-2"]);
    expect(refresh).toHaveBeenCalledTimes(1);

    requests[1].res.write('data: {"changed":true}\n\n');
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it("opens the stream again after the server ends it, as it does when a token expires", async () => {
    const { requests, fetch: toServer } = await serve(openStream);
    const refetch = vi.fn();
    stop = listenForChanges(refetch, { current: 0 }, { fetch: toServer, getToken: () => "access-1", refresh: async () => "ok" });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0].res.end();
    // The first wait before trying again is one second.
    await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 4000 });
    // What may have been missed in between is fetched once the new one is open.
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});
