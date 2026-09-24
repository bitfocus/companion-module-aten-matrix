# TODO / Ideas

Not committed to any of these — just tracked here for later investigation.

## More of what the matrix can do

Four things the matrix offers that the module does not touch yet. None of them can be set
over Telnet: asked for its command list with `H`, a VM0808HB answers with exactly

    H, IP, LO nn, PW, RI nn, RO nn, SB nn, SS nn,mm, SV nn, TI nn, VR, Ctrl-Q

plus the undocumented `read` and `reset`. So all four have to go through the web interface,
the way the port names already do.

1. **Mute and Mute All.** `read` reports `audio on` or `audio off` per output, so the state
   can be polled and turned into a feedback and a variable without any new plumbing. The web
   interface has a "Mute all" checkbox on the profile page and reports the overall state as
   `R1_MuteStatus` in `lib/profile_list.xml`. Per-port support is advertised in
   `lib/video_wall.xml` as `muteCheckSupport` (`1,1,1,1,1,1,1,1` on the VM0808HB), so the
   action should be hidden or refused where a port does not support it.

2. **Blank and Blank All.** The same shape: `read` reports `video on`/`video off` per
   output, the web interface has a "Blank all" checkbox, and the overall state is
   `R1_BlankStatus`.

3. **HDCP mode, with feedback and variable.** Capabilities differ per direction and per
   model, and the web interface says which: `data/mainpage/mainpage.xml` carries
   `HDCP_IN_Support` and `HDCP_OUT_Support` as one digit per port. On the VM0808HB that is
   `11111111` for inputs and `00000000` for outputs - so on this model only the input side
   can be set, and the module has to read those masks rather than assume. Where the mode is
   read back from is still open; `read` does not mention HDCP.

4. **CEC on/off.** `data/mainpage/mainpage.xml` advertises `CECCheckSupport`, `11111111` on
   the VM0808HB. Same open question: `read` says nothing about CEC, so either a Telnet
   command reports it or the state has to come from the web interface.

Worth noting for all four: `read` already carries the mute and blank state, so switching
the poll over to it (see below) would deliver those feedbacks almost for free.

## More of the web interface

The web interface turned out to be a plain HTML/AJAX application, and the module already
uses it for the port and profile names (see `src/http.js`): POST the credentials to
`/login/checkuser.asp`, read the session id out of the response body, then call the same
endpoints the web pages use. Worth picking up from there:

1. **Save a profile under a name.** The matrix has no rename: posting a name to
   `/profile_list2.asp` saves a profile into the slot, which was confirmed by aiming it at
   an empty slot and watching one appear. So the sensible action is "Save Preset" with a
   slot and a name - store the current routing over Telnet (`SV nn`), then set the name.
   Still to confirm: whether that POST writes the same routing `SV` does, or something of
   its own. `/profile_list.asp` with `R1_DeleteProfile` empties a slot again.

2. **Controlling the matrix over HTTP instead of Telnet.** There is no WebSocket: the web
   pages poll XML files (e.g. `lib/video_wall.xml`) and post to `.asp` endpoints. That is a
   workable transport, but polling XML is not obviously better than the Telnet session,
   which already pushes switch notifications.

3. **Other things the web interface knows.** The per-port capability masks in
   `data/mainpage/mainpage.xml` and `lib/video_wall.xml` say which of mute, CEC, HDCP, OSD
   and seamless switching a given model actually supports - see the section above, which is
   where they would be put to use.

## Use "read" for polling

The matrix answers `read` with its whole state in one go, including every route
("o01 i01 video on audio on" per output), the EDID mode, the firmware version and the
network settings. Polling that once would replace the `RO 1`..`RO n` loop - one command
instead of one per input - and would also give us the video/audio mute state per output.

## Detect the logged-in user's permission level

The matrix has its own user accounts with three permission levels (Administrator, Advanced
User, Basic User - see the web UI's User Account page). A Basic User can only open profiles,
so actions like Save Preset, or the factory reset, will presumably be refused for them. The
module currently has no idea which level it is logged in as, and would just look like the
command silently did nothing.

Unknown: whether the Telnet interface exposes the level at all. It is not in the documented
command list (`H`/`GT`/`IM`/`IP`/`LO`/`PW`/`RI`/`RO`/`SB`/`SS`/`SV`/`TI`/`VR`), so the
likely routes are:

- the login banner differing per level - worth comparing a Basic User login against an
  Administrator one
- the matrix answering a privileged command with an error, which we could detect and surface

Easiest way to find out: create a Basic User on the device, log the module in as that user,
and watch the debug log - unrecognized lines are logged, so whatever the matrix says about
permissions will show up there. Once detectable, `InstanceStatus.InsufficientPermissions`
exists for exactly this, and the affected actions could warn instead of failing silently.

## Detect whether an input has a signal - settled, not possible

Wanted so Companion could react to a source failing or coming back. **A VM0808HB does not
report this at all.** Established with a source on one input and every other input empty,
and not worth revisiting on this hardware - the front panel shows nothing either, so the
device most likely never determines it:

- Its own command list (`H`) holds nothing for it, and `RI nn` - the obvious candidate -
  turns out to be the inverse of `RO`: it reads which output an input is routed to, and
  answered `No port is connected to Input Port 08` for the very input that had a signal.
- `read` reports `video on audio on` per output whether that output carries a live input or
  a dead one; those are the blank and mute settings.
- Every status field the web interface has was captured with and without a source and came
  back identical: `HDCPinput`, `HDCPoutput`, `DisplayHDCP`, `RXHDCPSupport`,
  `DISPLAY_IDSTR`, all four Read Status groups and the OSD/CEC strings. The Read Status
  page's "Video Connection" group is the routing table, not a signal state.
- `RXConnectStatus` is a per-port mask the web interface tests exactly the way we would
  want, but "RX" means an HDBaseT receiver; it is empty on this model, whose
  `LiveView_Suppport` is `0`.
- `TxConnectStatus`, which does the same job for the other direction, turned out to be
  the sink side: it tracks what is plugged into the outputs, and the module now publishes
  it as `output_<n>_sinkactive`.
- It cannot be inferred from the output side either. With a monitor on output 5, switching
  that output from an input carrying a source to an empty one changed nothing at all:
  `HDCPinput`, `HDCPoutput`, `DisplayHDCP`, `RXHDCPSupport`, `DISPLAY_IDSTR`,
  `TxConnectStatus` and the OSD/CEC strings were identical before and after. The one
  caveat is that the test source was not HDCP-encrypted; an encrypted one might move the
  HDCP fields, but that would only ever detect HDCP sources, which is no basis for an
  automation.
- `read` takes no port argument on this firmware. ATEN documents a per-port form that
  answers "Signal: On/Off", but `read i07` and eight other spellings are all rejected
  with `Command incorrect`; that form belongs to another series.

What settles it is not the missing command but the missing display: the web interface reads
the sink side happily - `TxConnectStatus` and `DISPLAY_IDSTR` both track a monitor - and has
nothing at all for the source side. Neither does the front panel. Had the hardware known,
ATEN would have shown it.

Worth a fresh look only on a model that advertises `LiveView_Suppport` or is HDBaseT-based,
where `RXConnectStatus` may carry something real.

If it ever becomes available, the design to build is:

- a variable and a feedback for the immediate state, polled as often as the transport allows
- a second variable and feedback that only turn true once the signal has been present
  continuously for a configurable time, with a config field of roughly 1 to 10 seconds
- the stable one should drop to false immediately on loss rather than waiting out the timer:
  an automation wants to hear about a failure at once, and be cautious only about declaring
  recovery
- it should also start false after a restart, so reloading the module does not fire
  everyone's "signal is back" automations
- the timer can never be finer than the poll interval, so the poll has to be at least as
  fast as the shortest timeout the config offers
