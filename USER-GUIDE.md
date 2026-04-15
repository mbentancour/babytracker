# BabyTracker User Guide

A practical guide for parents using BabyTracker to track their baby's daily activities, growth, and milestones.

---

## Getting Started

1. **Create your account.** On first launch, you will be prompted to create an account with a username and password.
2. **Add your baby.** Enter your baby's first name, last name (optional), birth date, and — if you want WHO growth percentile charts — their sex.
3. **Start tracking.** The main screen shows your baby's dashboard, where you can see today's activity at a glance and log new entries.

To **add another baby** later, tap your current baby's name or photo to open the edit screen; there is an "+ Add Your Baby" button at the top right.

---

## The Dashboard

Your baby's dashboard is organized into four tabs:

- **Overview** -- Today's summary at a glance: last feeding, last sleep, last diaper change, and any active timers.
- **Growth** -- Charts showing weight, height, head circumference, and BMI over time.
- **Journal** -- A chronological log of all entries. You can filter by activity type to find what you need.
- **Photos** -- A gallery of all photos attached to entries, milestones, measurements, and standalone uploads.

---

## Tracking Activities

### Feedings

Record what your baby eats and how.

- **Type:** Breast milk, formula, fortified breast milk, or solid food.
- **Method:** Bottle, left breast, right breast, both breasts, parent fed, or self fed.
- **Amount and duration:** Optionally record how much (in ml or oz) and how long the feeding lasted.
- **Timer support:** Start a timer when a feeding begins, then log the details when it is done.

### Sleep

Track when your baby sleeps.

- Record a start and end time.
- Mark whether it was a nap or nighttime sleep.
- Timer support: start a timer at bedtime and stop it when your baby wakes.

### Diapers

Log diaper changes quickly.

- Mark the diaper as wet, solid, or both.
- Optionally track the color (black, brown, green, or yellow) -- helpful for newborns.

### Tummy Time

Track tummy time sessions.

- Record a start and end time.
- Add optional milestone notes (e.g., "lifted head for 10 seconds").
- Timer support.

### Temperature

Record temperature readings when your baby is unwell or for routine checks.

### Weight, Height, Head Circumference

Track growth measurements over time. These are displayed as charts on the Growth tab so you can see trends.

If your child's sex is set (in the edit-child screen), you can toggle **WHO** on any of the Weight/Height/Head Circumference/BMI charts to overlay the official [WHO growth percentile curves](https://www.who.int/tools/child-growth-standards). Your child's measurements appear as dots against the 3rd / 15th / 50th / 85th / 97th percentile lines. The overlay is for reference only — consult your paediatrician for medical advice.

### BMI

Body mass index can be calculated automatically from weight and height, or entered manually.

### Medications

Keep a record of any medications your baby takes.

- Name of the medication.
- Dosage amount and unit.
- Time it was given.

### Milestones

Record your baby's developmental milestones -- first smile, first steps, first words, and everything in between. You can attach a photo to each milestone.

### Notes

A simple way to jot down general observations that do not fit neatly into other categories.

### Pumping

Track pumping sessions with the amount collected and the duration.

---

## Using Timers

Timers make logging faster and more accurate.

1. Tap the timer button on the main screen to start a timer.
2. The timer runs in the background -- you can close the app and come back later.
3. When you are done, tap the timer to open a pre-filled form with the duration already calculated.
4. Timers are per-child, so they will not get mixed up if you are tracking more than one baby.

---

## Photos

- **Attach photos to entries.** When logging a feeding, milestone, measurement, or any other activity, you can attach a photo.
- **Upload photos directly.** Go to the Photos tab to upload photos without attaching them to a specific entry.
- **Profile pictures.** Set a profile picture for each child.
- **Tag photos with children.** Photos can be tagged with one or more children so they appear in the right gallery.
- **Click to enlarge.** Tap any photo in the gallery to open it full-screen. Use the left/right arrows (or keyboard arrow keys) to browse, Escape or tap outside to close.
- Untagged photos are treated as shared and will appear in every child's gallery.
- The gallery displays thumbnails for fast loading; full-resolution originals are used only when a photo is opened or shown in picture frame mode.

---

## Picture Frame Mode

Turn a spare tablet into a digital photo frame that cycles through your baby's pictures.

- **Idle timeout:** In Settings, set an idle timeout so picture frame mode activates automatically after a period of inactivity.
- **Always-on mode:** Add `?slideshow=true` to the URL to start picture frame mode immediately.
- **Filter photos:** In Settings, choose which types of photos to include in the slideshow.
- **Live status overlay:** Optionally show small status items on top of the slideshow — time since last feeding / sleep / diaper, running timers, or the current time. Configurable per-item in Settings → General → Picture Frame → Live status overlay.
- **Remote control:** If you have named your device in Settings, you can control picture frame mode remotely through the Display Control API -- handy for turning it on or off from another device or from Home Assistant.

---

## Settings

### Per-device vs. shared settings

Some settings are saved **in this device's browser only**, others are stored on the BabyTracker server and **apply to every user and device**. This is intentional — it lets you tailor each device to how it is used:

- A wall-mounted tablet can run in dark theme with a long picture-frame timeout; your phone stays on light theme with no slideshow.
- Your partner can have a different language than you without changing yours.
- A kitchen iPad can hide features you rarely track on that device, keeping the interface simple.
- Form defaults (your preferred feeding type, diaper color, etc.) can differ per device — useful if one device is typically used at night and another during the day.

**Per-device** (saved in the browser, different on every phone/tablet/computer):
- Unit system
- Theme
- Language
- Picture frame timeout and overlay items
- Device name
- Feature visibility toggles
- Form defaults (feeding type/method, diaper color, medication dosage unit, auto-calculate BMI)

**Shared** (stored on the server, same for everyone):
- Your user account and password
- Children and all tracked data (feedings, sleep, photos, etc.)
- Backup frequency
- API tokens and webhooks
- Users and roles
- Custom domain (appliance mode)

If you clear your browser data or sign in from a new device, the per-device settings reset to defaults — your tracked data is not affected.

### General

- **Unit system:** Choose between metric and imperial.
- **Theme:** Light, dark, or match your system setting.
- **Language:** English, Spanish, or Danish.
- **Picture frame timeout:** How long before picture frame mode activates automatically. Also includes the live status overlay toggles (see Picture Frame Mode above).
- **Device name:** Give this device a name for remote display control.
- **Custom domain:** Available in appliance mode only. Point a domain name at your device to enable Let's Encrypt HTTPS certificates.
- **Change password:** Update your account password.
- **Restart / Shut down:** Available in appliance mode only. Safely reboot or power down the device from the UI.

### Features

Toggle which tracking features are visible. If you do not need to track pumping or medications, for example, you can hide them to keep the interface simple.

### Defaults

Save time by setting default values for things you log often:

- Default feeding type and method.
- Default diaper color.
- Default medication dosage unit.

### Data

- **Export as CSV:** Download all your data as a spreadsheet-friendly CSV file.
- **Backups:** Create, download, restore, or delete backups of your data.
- **Automatic backups:** Set how often backups are created automatically.
- **Import from Baby Buddy:** If you are migrating from Baby Buddy, you can import your existing data.

### Integrations (admin only)

- **API tokens:** Create tokens so external systems (Home Assistant, scripts, etc.) can read or write your data. Choose Read only or Read & Write scope.
- **Webhooks:** Send HTTP notifications to another system whenever data changes. Useful for triggering automations outside BabyTracker.

### Users & Roles (admin only)

- **Create accounts:** Add user accounts for partners, grandparents, or caregivers.
- **Create custom roles:** Define roles with specific permissions per feature (none, read, or write).
- **Grant access:** Assign users access to specific children with specific roles.
- **Reset passwords:** Reset the password for any user account.

---

## Multi-Child Support

- Add multiple children from the dashboard.
- Switch between children using the selector at the top of the screen.
- Each child has independent data, photos, and a profile picture.
- Users can be granted access to specific children, so you can share selectively.

---

## Home Assistant

If you use Home Assistant, there is a dedicated integration that exposes per-child sensors, fires events when new activity is logged, and provides services to log activities from automations. See the [babytracker-homeassistant](https://github.com/mbentancour/babytracker-homeassistant) repository for installation and examples.

Typical things you can do:

- Show a card on your dashboard with "last feeding was 2h 15m ago"
- Get a phone notification if temperature is above 38°C
- Turn on a nightlight when a sleep timer is running
- Tap a button to log a wet diaper without opening the app
- Start the picture frame slideshow on a bedroom tablet when the lights go off

## Tips

- **Use timers for feedings and sleep.** They make logging much faster and you will not have to remember exact start times.
- **Check the Journal tab for patterns.** It is a great way to spot trends in sleep, feeding, or diaper changes.
- **Set up automatic backups.** Go to Settings > Data and configure a backup frequency. Peace of mind in case anything goes wrong.
- **Try picture frame mode on a tablet.** It is a lovely way to display your favorite baby photos as a screensaver when the tablet is not in use.
