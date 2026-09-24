# companion-module-aten-matrix

A [Bitfocus Companion](https://bitfocus.io/companion) module to control ATEN HDMI matrix switches over Telnet.

It has been tested with the ATEN VM0808HA. See [companion/HELP.md](companion/HELP.md) for the full list of actions,
feedbacks and variables shown inside Companion.

## Compatible devices

All of ATEN's "VanCryst" HDMI matrix switches (the Standard, Seamless and HDBaseT product lines) share the same
Telnet command set (`SS`/`RO`/`LO`/...) this module speaks, confirmed against ATEN's own manuals for the VM0808HA,
VM0404HB/VM0808HB, VM51616H and VM3404H. The rest of the lineup below is expected to work the same way, but hasn't
been individually verified.

**Current**

- VM0202H / VM0202HB – 2x2 (True) 4K HDMI Matrix Switch
- VM0404HA / VM0404HB – 4x4 (True) 4K HDMI Matrix Switch
- VM0808HB – 8x8 True 4K HDMI Matrix Switch
- VM3404H – 4x4 4K HDMI HDBaseT-Lite Matrix Switch
- VM5404H / VM5404HA – 4x4 HDMI Matrix Switch with Scaler
- VM5808H / VM5808HA – 8x8 HDMI Matrix Switch with Scaler
- VM6404HB – 4x4 True 4K HDMI Matrix Switch with Scaler
- VM6809H – 8x9 4K HDMI Matrix Switch with Scaler
- VM51616H – 16x16 HDMI Matrix Switch with Scaler

**Discontinued**

- VM0404H – 4x4 HDMI Matrix Switch
- VM0808H – 8x8 HDMI Matrix Switch
- VM0808HA – 8x8 4K HDMI Matrix Switch (the model this module was originally tested with)
- VM6404H – 4x4 4K HDMI Matrix Switch with Scaler
- VM3909H – 9x9 4K HDMI HDBaseT-Lite Matrix Switch

ATEN's modular chassis-based matrix switches (VM1600/VM1600A, VM3200/VM3250) use swappable I/O boards and a
different management architecture, so it's unconfirmed whether they speak the same command set.

## Configuration

| Field        | Description                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| Target IP    | IP address of the matrix                                                          |
| Username     | Telnet login username (default `administrator`)                                   |
| Password     | Telnet login password (default `password`)                                        |
| _(checkbox)_ | "Automatically change to selected password if factory default password is active" |

Nothing has to be enabled on the matrix first: Telnet is always on, and always on port 23, which it offers no way
to change.

## Port and preset names

Ports and presets can be given names in the matrix's web interface, and the module puts those names behind the
number in every dropdown ("Input 5 - Input5Server", "Preset 2 - Test2") and publishes them as `input_<n>_name`,
`output_<n>_name` and `preset_<n>_name`. The Telnet protocol does not carry them, so the module reads them over
HTTP with the same credentials, straight after logging in. If the web interface cannot be reached everything just
keeps its generic name – nothing else is affected.

The matrix calls its presets "profiles" and always offers a fixed number of slots, most of them empty. Only the
slots that hold a profile get a variable and a ready-made button; an empty slot is left out rather than shown
under the matrix's placeholder name "Untitled".

Since the matrix never announces a rename, there is a **Refresh port and preset names** action for names changed
elsewhere, and a **Rename port** action that renames a port on the device and reads the names back to confirm it
took.

Letters (umlauts included), digits, spaces and ``! # $ % - . ^ _ ` { } ~`` are accepted; the characters
`" & ' ( ) * + , / : ; < = > ? @ [ \ ] |` are dropped, because the matrix silently discards a whole submission
containing any of them. A name may be 30 characters long – the device itself takes 63 bytes, but its web
interface caps the field at 30, so names stay editable there.

There is no matrix size to configure: the matrix names its own model when logging in ("Connection to VM0808HB is
established"), and for every model listed above the module takes the number of inputs and outputs from that. The
config page then just states which model was found. Only if the matrix reports a model this module does not know
does a size dropdown appear, so a comparable one can be picked. The model is also published as the `model`
variable.

A factory-fresh or factory-reset matrix still uses its default password and forces a change before it can be used.
Enter the password you want it to use in "Password" and tick the checkbox: when the configured password is
rejected, the module tries the factory default once and, if that works, sets your password on the device. With the
checkbox off it reports what is going on and leaves the device alone.

Either way the module makes at most two login attempts in a row, because the matrix locks logins out for several
minutes after a few rejected ones. It also backs off exponentially between reconnects (capped at 5 minutes) and
stops retrying entirely once a login was rejected - fix the config and save it to retry.

## Actions, feedbacks & variables

**Actions**

- **Route Input directly to Output** – route an input to an output in one step, without the take workflow
- **Select source for take** / **Select destination for take** / **Take** – two-step routing: pick an input and an
  output on separate buttons, then press a Take button to route them
- **Recall Preset** / **Save Preset** – recall or store one of the matrix's connection profiles
- **Refresh routing status** – re-read the routing of every output from the matrix
- **Refresh port and preset names** – re-read the names, and which preset slots are in use, from the web interface
- **Rename port** – rename an input or output on the matrix itself
- **Factory reset device** – ⚠️ erases all settings on the matrix; requires a confirmation checkbox to be ticked in
  the action's options, and is deliberately left out of the ready-made presets below

Every input and output is picked from a dropdown that also offers "Selected source"/"Selected destination" – the
port the take workflow currently has selected, and the default. In expression mode, a port number or the word
`selected` is accepted.

**Feedbacks**

- **Route** – true if the given input is routed to the given output (both default to the selected source/destination)
- **Source selected** / **Destination selected** – true if the given input/output is selected for a take
- **Preset recalled** – true if the given preset was the last one recalled via Companion
- **Display connected** – true while something is plugged into the given output
- **Connected** – true while the module has an active, logged-in Telnet session with the matrix

**Variables**

- `output_<n>_source` – input currently routed to output `n`, updated live on every switch and re-read every 15 seconds
- `input_<n>_name` / `output_<n>_name` – name of the port as set in the matrix's web interface
- `preset_<n>_name` – name of preset `n`, for every slot the matrix has a profile saved in
- `output_<n>_sinkactive` – `true` while a display is plugged into output `n`, empty until the web interface answers

The matrix never says in words which outputs have a display, but its web interface has the information: one
digit per output, which its General page turns into a red cross. The module polls that every 2 seconds on a
session it keeps open, so one read costs a single request of about 60 ms, and publishes it as the variable and
feedback above.

- `model` – model name the matrix reported on login
- `last_preset` – last preset recalled via Companion
- `firmware_version` – software version reported by the matrix
- `selected_source` / `selected_destination` – input/output currently picked for a take, empty while nothing is selected
- `selected_source_name` / `selected_destination_name` – the name of that port, likewise empty when nothing is selected

**Presets**

Ready-made buttons for the actions and feedbacks above. The "Select Input" and "Select Output" buttons are one
definition each, generated per port: they show the port number and name, turn green while selected, and mark the
live routing – an input lights a bar while it feeds the selected output, an output always names the input feeding
it. The "Take" button spells out the pending route and makes it. On top of that there is one button per profile
the matrix actually has saved, and a "Connected" status button.

Buttons created with the previous version of this module (the `Set Crosspoint`, `Load Profile` and `Crosspoint set`
definitions) are migrated to the new actions and feedbacks automatically.

## License

MIT, see [LICENSE](LICENSE).
