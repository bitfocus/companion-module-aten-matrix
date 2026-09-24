# ATEN HDMI Matrix

This module connects to ATEN HDMI Matricies via Telnet. It has been tested with:

- ATEN VM0808HA

But it should also work with:

- ATEN VM0404HA
- ATEN VM0404HB
- ATEN VM0808HA
- ATEN VM0808HB
- ATEN VM51616H

And maybe others using same control protocol.

The matrix names its own model when logging in, and for the models listed above the module takes its number of
inputs and outputs from that - there is nothing to configure. A size dropdown only appears if the matrix reports a
model this module does not know yet. The Telnet port is always 23.

A factory-fresh or factory-reset matrix still uses its default password and forces a change before it can be used.
Enter the password you want it to use in the "Password" field and tick "Automatically change to selected password
if factory default password is active": the module then tries the factory default once when the configured
password is rejected and, if that works, sets your password on the device.

The matrix locks logins out for several minutes after a few rejected ones, so the module never makes more than two
attempts in a row, backs off between reconnects, and stops retrying once a login was rejected - fix the config and
save it to retry.

## Available Actions

- **Route Input directly to Output** – route an input to an output in one step, without the take workflow
- **Select source for take** / **Select destination for take** / **Take** – two-step routing: pick an input and an output on separate buttons, then press a Take button to route them
- **Recall Preset** / **Save Preset** – recall or store one of the matrix's connection profiles
- **Refresh routing status** – re-read the routing of every output from the matrix
- **Refresh port and preset names** – re-read the names, and which preset slots are in use, from the web interface
- **Rename port** – rename an input or output on the matrix itself
- **Factory reset device** – ⚠️ erases all settings on the matrix (IP, login, saved profiles); requires a
  confirmation checkbox to be ticked in the action's options, and is not included in the ready-made presets below

Wherever an input or output is picked, the dropdown also offers "Selected source"/"Selected destination", which
means whatever the take workflow currently has selected. That is the default. In expression mode, write either a
port number or the word `selected`.

## Port and preset names

Ports and presets can be named in the matrix's web interface. The module shows those names behind the number in
every dropdown ("Input 5 - Input5Server", "Preset 2 - Test2") and publishes them as variables. The Telnet
protocol does not carry them, so they are read over HTTP with the same username and password - if the web
interface cannot be reached, everything simply keeps its generic name.

The matrix calls its presets "profiles" and always has a fixed number of slots, most of them empty. Only the
slots that actually hold a profile get a `preset_<n>_name` variable and a ready-made button; an empty slot is
left out entirely rather than shown as "Untitled".

The matrix does not announce a rename, so use **Refresh port and preset names** after renaming one elsewhere. The
**Rename port** action renames a port on the device and re-reads the names straight afterwards to confirm it
took. Letters (umlauts included), digits, spaces and ``! # $ % - . ^ _ ` { } ~`` are accepted, up to 30
characters; the characters `" & ' ( ) * + , / : ; < = > ? @ [ \ ] |` are dropped, because the matrix refuses a
name containing any of them.

## Available Feedbacks

- **Route** – true if the given input is routed to the given output (both default to the currently selected source/destination)
- **Source selected** / **Destination selected** – true if the given input/output is currently selected for a take
- **Preset recalled** – true if the given preset was the last one recalled via Companion (presets recalled from the front panel, web UI or another controller are not reflected)
- **Display connected** – true while something is plugged into the given output
- **Connected** – true while the module has an active, logged-in Telnet session with the matrix

## Available Variables

- `output_<n>_source` – number of the input currently routed to output `n`, updated live whenever the matrix reports a switch and re-read every 15 seconds
- `input_<n>_name` / `output_<n>_name` – name of the port, as set in the matrix's web interface (falls back to "Input 3"/"Output 3")
- `preset_<n>_name` – name of preset `n`, for every preset slot the matrix has a profile saved in
- `output_<n>_sinkactive` – `true` while something is plugged into output `n`, `false` when nothing is, and empty while the web interface has not been reached; polled every 2 seconds
- `model` – model name the matrix reported on login, e.g. `VM0808HB`
- `last_preset` – number of the last preset recalled via Companion
- `firmware_version` – software version reported by the matrix
- `selected_source` / `selected_destination` – input/output currently picked for a take, via the "Select source/destination for take" actions; empty while nothing is selected
- `selected_source_name` / `selected_destination_name` – the name of that port, likewise empty while nothing is selected

## Available Presets

Ready-made buttons, grouped into sections:

- **Select Input** – one button per input, showing its number and name, green while it is the selected source, plus a
  yellow bar along the bottom while that input feeds the currently selected output
- **Select Output** – one button per output, showing its number and name, green while it is the selected destination,
  with a yellow band naming the input that currently feeds it
- **Take** – spells out the pending route ("IN3 (Kamera) to OUT5 (Regie)") and makes it when pressed
- **Presets** – one button per profile the matrix actually has saved, showing its number and name, highlighted while it's the last one recalled via Companion
- **Connected** – shows the module's Telnet connection state
