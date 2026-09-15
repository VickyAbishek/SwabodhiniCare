# SwabodhiniCare — UI/UX Design Prompt

> **How to use this file**
> - Copy everything from **"PROMPT STARTS"** to **"PROMPT ENDS"** into any AI design tool (Claude, v0, Lovable, Google Stitch, Figma Make, Galileo, etc.).
> - Want the tool's own visual ideas? **Delete section 7 ("Visual direction")** before pasting. Every other section is a hard requirement.
> - Big screens? Paste the whole prompt, then ask for **one screen at a time** by its number from section 9 (e.g. "Design screen S5 now").
> - Source of truth: `docs/superpowers/specs/2026-09-15-swabodhinicare-design.md`. If this prompt and the spec disagree, the spec wins.

---

## PROMPT STARTS

### 1. What you are designing

**SwabodhiniCare** is a registration and admission app for **Swabodhini Autism**, a non-profit school in Chennai, India. It supports children and adults with autism across **4 centres**: Thiruvanmiyur, Velachery, Tondiarpet and Selaiyur.

What happens today on paper, and what the app does instead:
1. A parent comes to the centre. A **therapist** sits with them and fills in a combined **enquiry + assessment form** on a phone. The form has 11 sections.
2. The application goes to the **Therapy Head** (clinical review), then the **Centre Head** (admin/capacity review), then the **Director**. At each step the reviewer can **Approve**, **Send back** (with a comment) or **Reject** (with a reason).
3. The Director gives the final decision (**Admit** or **Waitlist**). Their stored signature is stamped on the printable report, and a registration number is issued.
4. Management uses **reports** to see who can go ahead and how each centre is doing.

The single job of the app: **move each applicant's file from the first conversation to a signed decision, without anything getting lost.**

### 2. Who uses it (design for them first)

- School staff, **mostly aged 45–65+**. Many aren't comfortable with technology. Some have reduced eyesight and wear reading glasses.
- **Mainly on Android phones** (mid-range and older, 360–412 px wide). The Director and Centre Heads sometimes use a desktop for reports.
- **Tamil-first.** Most staff prefer Tamil; some prefer English. Every screen must work fully in both.
- They use the app **while sitting with a worried parent**, often on patchy campus Wi-Fi. It must feel calm and trustworthy, never rushed or "techy".
- Roles: **Therapist, Therapy Head, Centre Head, Director, Admin**. One person can hold more than one role.

### 3. Hard constraints (do not break these)

**Technology**
- Output **plain HTML + CSS + a little vanilla JavaScript**. No React/Vue, no Tailwind, no UI kits, no icon fonts. (The app is built with zero dependencies so an NGO with no IT staff never has to patch anything.)
- In production, fonts are **self-hosted**: no Google Fonts, CDNs or external images. (Using Google Fonts in a mockup is fine.)
- Icons are simple **inline SVG**, and **always shown with a text label**.
- Mobile-first from **360 px**. Desktop layout from **1024 px**.

**Accessibility for older users**
- Body text at least **18 px** (Tamil **19 px**, line height ~1.7). Headings 24–28 px. Nothing important smaller than 15 px.
- **Tap targets at least 48 × 48 px** (main buttons 56 px tall), at least 8 px apart. Main actions are full width on phones.
- Contrast **WCAG AA or better** (aim for AAA on body text). **Never use colour alone**: every status has a word, and ideally a shape or icon too.
- **No hidden gestures**: no swipe-only, long-press or hover-only actions. No icon-only buttons.
- Labels **always above fields**. No placeholder-only fields. Required fields say *"(required)"* in words.
- **One form section per screen**, with *"Step 3 of 11"* and a visible progress bar. **Back** and **Save & Next** always at the bottom.
- Prefer **big tap-choice buttons** over typing: segmented choices, not tiny radio dots.
- Date of birth = **three dropdowns** (Day / Month / Year), never a calendar picker.
- A visible **keyboard focus** state. Respect `prefers-reduced-motion`. Minimal animation.
- Plain-language confirmations, e.g. *"Send this application to the Therapy Head? You can't edit it after sending."* → **Yes, send** / **No, go back**.

**Bilingual (Tamil / English)**
- A language switch (**தமிழ் | English**) is **always visible in the header**, not hidden in a menu. The app's default is Tamil.
- Tamil text is often **30–50% longer** and taller than English. Layouts must **wrap, never truncate**. No fixed-width buttons that clip Tamil.
- Suggested fonts: **Noto Sans Tamil** or **Mukta Malar** for Tamil; a highly legible sans for English (e.g. **Atkinson Hyperlegible**).
- Staff may type answers in either language. Show them exactly as typed.

**Appearance**
- **Light mode is the default.** Design the light theme first.
- Users can switch to **Dark** in **Settings** (screen S13). The app **never switches by itself** based on the phone's dark-mode setting.
- Provide the dark theme as the same set of colour tokens with different values. Both themes meet the same contrast rules. **Printed reports are always light.**

**Privacy**
- This is sensitive data about children. Show only what each screen needs. No child photos on list screens larger than a small thumbnail.

### 4. Tone of voice

Warm, plain, respectful. Write like a helpful senior colleague, not like software.
- Buttons say exactly what happens: **"Save & Next"**, **"Send to Therapy Head"**, **"Sign and admit"**. Never "Submit" or "OK".
- Errors explain the fix: *"Enter the phone number with 10 digits."* Never *"Invalid input."*
- Empty states invite action: *"No applications are waiting for you. New ones will appear here."*

### 5. Key strings (use these, EN / TA)

| English | தமிழ் |
|---|---|
| Sign in | உள்நுழைக |
| Email | மின்னஞ்சல் |
| Password | கடவுச்சொல் |
| Forgot your password? Ask the Admin at your centre to reset it. | கடவுச்சொல் மறந்துவிட்டதா? உங்கள் மைய நிர்வாகியிடம் மாற்றித் தரச் சொல்லுங்கள். |
| Waiting for you | உங்களுக்காகக் காத்திருக்கிறது |
| New application | புதிய விண்ணப்பம் |
| Step 6 of 11 | படி 6 / 11 |
| Save & Next | சேமித்து அடுத்து |
| Back | பின் செல் |
| Saved ✓ 10:42 | சேமிக்கப்பட்டது ✓ 10:42 |
| Not saved — check Wi-Fi | சேமிக்கப்படவில்லை — Wi-Fi-ஐ சரிபார்க்கவும் |
| Independently / With help / Not yet | தானாக / உதவியுடன் / இன்னும் இல்லை |
| Never / Sometimes / Often | ஒருபோதும் இல்லை / சில நேரங்களில் / அடிக்கடி |
| Approve | ஒப்புதல் அளி |
| Send back | திருப்பி அனுப்பு |
| Reject | நிராகரி |
| Admit / Waitlist | சேர்க்கை / காத்திருப்புப் பட்டியல் |
| Sign and admit | கையொப்பமிட்டு சேர்க்கவும் |
| Download Excel | Excel பதிவிறக்கு |
| Therapist / Therapy Head / Centre Head / Director / Admin | சிகிச்சையாளர் / சிகிச்சைத் தலைவர் / மையத் தலைவர் / இயக்குநர் / நிர்வாகி |
| Thiruvanmiyur / Velachery / Tondiarpet / Selaiyur | திருவான்மியூர் / வேளச்சேரி / தண்டையார்பேட்டை / சேலையூர் |

*(Tamil is a first draft; school staff will review it.)*

### 6. Application statuses (each needs a word + a distinct look)

`Draft` · `Waiting for Therapy Head` · `Waiting for Centre Head` · `Waiting for Director` · `Sent back` · `Admitted` · `Waitlisted` · `Rejected` · `Withdrawn`

Show the approval route (**Therapist → Therapy Head → Centre Head → Director**) as a visible **4-step track** wherever an application appears. Staff should see at a glance where the file is and who has it.

### 7. Visual direction (OPTIONAL — delete this section to let the tool explore)

- Mood: **a well-kept school office file**. Calm, orderly, human, like a paper case file with rubber stamps and signatures, made digital. Not a startup dashboard, not playful or childish, no cartoon puzzle pieces.
- Palette idea: a cool pale-green "register paper" background; deep **fountain-pen teal** (#0F5C6E) for primary actions and text accents; **marigold** (#E8A317) used sparingly for "your turn" highlights; separate, clearly different semantic colours for approved (green), sent back (amber) and rejected (red).
- Statuses shown as **rubber-stamp style badges** (bordered, slightly tilted, monospaced capitals in English).
- Numbers such as application and registration numbers in a **monospace** face, like a file reference.
- Avoid: purple gradients, glassmorphism, dark-mode-only designs, tiny grey text, emoji as icons, dense tables on phones.
- Light is the main design; the dark theme is a secondary version of the same tokens.

### 8. Sample data (fictional; use it so designs look real)

- Staff: *Priya S* (Therapist, Velachery) · *Lakshmi R* (Therapy Head) · *Suresh M* (Centre Head, Velachery) · *Dr. Revathi N* (Director) · *Anand K* (Admin)
- Applicants:
  - *Arjun Karthik*, 6 y 6 m, male, Velachery, `APP-2026-0042`, waiting for Centre Head, suitable, Special Education + Speech Therapy, **wanders off: often (safety flag)**
  - *Meenakshi R*, 4 y 2 m, female, Thiruvanmiyur, `APP-2026-0045`, waiting for Therapy Head, needs further assessment
  - *Vishal S*, 19 y, male, Selaiyur, `APP-2026-0038`, waiting for Therapy Head, Vocational Training, waiting 9 days (overdue)
  - *Kavya P*, 8 y, female, Tondiarpet, `APP-2026-0031`, admitted, `SWB/TDP/2026/0009`
- September 2026 numbers: 24 submitted → 11 admitted, 5 waitlisted, 3 rejected, 5 in review.
  - Thiruvanmiyur 9 (5 admitted / 2 waitlisted / 1 rejected / 1 in review)
  - Velachery 7 (3/1/1/2)
  - Tondiarpet 4 (2/1/0/1)
  - Selaiyur 4 (1/1/1/1)

### 9. Screens to design

Show each phone screen at **390 × 844**. Also show **S1, S4 and S6 in Tamil**.

| # | Screen | Who | Must include |
|---|---|---|---|
| S1 | **Sign in** | All | App name + school name; big language choice (தமிழ் / English); email; password with a **Show** button; **Sign in**; forgot-password help text; a *"Signing in…"* state (it takes ~1 s) |
| S2 | **My Queue (home)** | All, shown for Therapy Head | Greeting with name + role + centre; **how many are waiting for me** as the main element; cards for each waiting application (name, age, centre, app no., who sent it, how long ago, 4-step track, overdue flag); **New application** button; bottom nav with labels (Home / New / Reports) |
| S3 | **Form: Applicant details** (step 2 of 11) | Therapist | Progress (11 steps); full name; name in Tamil; date of birth as 3 dropdowns + age worked out automatically; gender as 3 big choices; **photo** (Take photo / Choose from gallery); UDID card (Have / Applied / No); save status; Back / Save & Next |
| S4 | **Form: Current abilities** (step 6 of 11) | Therapist | Communication as 5 large options; eating, toileting, dressing, responds to name, each with **Independently / With help / Not yet**; save status; Back / Save & Next |
| S5 | **Form: Consent** (step 11 of 11) | Therapist + parent | Consent text (EN + TA) about storing the child's data; parent name; relationship; **signature pad** (finger) with Clear; date filled in automatically; **Send to Therapy Head** + confirmation dialog |
| S6 | **Review** | Centre Head | Applicant summary (photo thumb, name, age, centre, app no.); key facts (diagnosis, suitability, recommended programs, **safety flags**); *Read full application*; **approval route** with past decisions, names, dates, comments; comment box (required for Send back / Reject); **Approve**, **Send back**, **Reject** |
| S7 | **Final decision** | Director | Admit / Waitlist choice; registration number preview (`SWB/VLC/2026/0013`); preview of the stored signature with name + date; **re-enter password to sign**; **Sign and admit**; note that the application will be locked |
| S8 | **Sent back** state | Therapist | How a returned application looks in the queue and inside the form: the reviewer's comment shown prominently at the top, with a **Fix and resend** path |
| S9 | **Reports** (desktop 1280 px + phone version) | Heads, Director | Filters (centre, month, status); summary counts; **by-centre stacked bar chart**; application register table; **Download Excel** |
| S10 | **Individual Assessment Report** (A4 print) | Heads, Director | Letterhead; app + registration no.; applicant details; summary of each section; therapist recommendation; approval trail table; **Director's signature**; form fingerprint (short hash); page numbers |
| S11 | **Admin: Users** | Admin | Staff list with roles as chips; add staff; **reset password** (shows a temporary password once); deactivate |
| S12 | **Admin: Backups & usage** | Admin | Latest monthly backup status (Complete / Running / Failed) with *Open as Excel*; storage meter (e.g. 1.2 GB of 8 GB) and today's upload/download counts against limits; plain-language warning when near a limit |
| S13 | **Settings** | All | Language (தமிழ் / English); Appearance: **Light** (default) / Dark, with a one-line explanation; the user's name, role(s), email; **Change password**; **Sign out**; a note that settings are saved to their account |

### 10. States to show

- Loading (a skeleton or plain *"Loading…"* in both languages)
- Saving (*"Saving…"*; in the first version a save can take 1–3 seconds, so it must be clearly visible and never block reading)
- Empty queue
- Field error (inline, next to the field, with how to fix it)
- **Offline / not saved** banner
- **"Someone else updated this form — tap to reload"** conflict message
- Account locked after 5 wrong passwords (*"Try again in 15 minutes or ask your Admin"*)
- Storage full (*"Storage full — contact Admin"*) on the photo upload

### 11. What to deliver

1. The screens above (phone frames; desktop where stated), in English and Tamil as listed in section 9.
2. A small **component sheet**: buttons (primary / secondary / approve / send back / reject), text field, dropdown, 3-choice segmented control, status stamps, 4-step track, save-status line, banners, bottom action bar.
3. **Design tokens**: colours (light + dark) with contrast ratios, type scale (EN + TA), spacing, radii.
4. If you output code: one HTML file per screen or a single page with all screens, plain CSS, no frameworks.

## PROMPT ENDS
