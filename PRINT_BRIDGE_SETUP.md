## Local ESC/POS Print Bridge for TVS RP-3200 Lite

This bridge prints receipts directly to the Windows printer using raw ESC/POS commands.
It is meant to feel like part of the same software.

### 1. Install the Python dependency on the Windows machine

```bash
pip install -r print_bridge_requirements.txt
```

## Better option: build a Windows EXE

On the Windows machine, run:

```text
build_print_bridge_exe.bat
```

This creates:

```text
dist\KNP Signature Print Service.exe
```

That EXE can be used instead of directly running `python print_bridge.py`.

### 2. Start the local bridge

Run this on the Windows machine that is connected to the TVS printer:

```bash
python print_bridge.py
```

or run the built EXE:

```text
dist\KNP Signature Print Service.exe
```

It starts on:

```text
http://127.0.0.1:9876
```

### Easier Windows start

You can use:

```text
start_knp_signature_windows.bat
```

That does two things:

- starts the local print bridge in the background
- opens the frontend

If the EXE exists, the launcher uses the EXE automatically.
If not, it falls back to a background Python launch:

- `pythonw print_bridge.py` when available
- otherwise `py -3 print_bridge.py`

The launcher also waits briefly for `http://127.0.0.1:9876/health` before opening the app, so the client does not need to manually start `print_bridge.py` in a terminal.

### One-time automatic startup setup

Run this once on the Windows machine:

```text
install_knp_signature_startup.bat
```

That installs a hidden startup launcher into the Windows Startup folder.

After that:

- when the PC starts, the print bridge starts automatically
- the client does not need to manually run the helper every time
- he can simply open the software and print

If you want to use the EXE version in Startup later, replace the startup target with the built EXE.
You do not need to manually change anything if you keep using `start_knp_signature_windows.bat`, because it auto-detects the EXE.

### 3. Make sure the TVS printer is set as the Windows default printer

The bridge prints to the default Windows printer unless a printer name is added later.

### 4. Use Print Bill / Print Payment Receipt in the app

The frontend now tries the local print bridge first.

- If the bridge is running, it sends the receipt directly as raw ESC/POS.
- If the bridge is not running, it falls back to browser print.

### 5. Optional test

Open in a browser on the Windows machine:

```text
http://127.0.0.1:9876/health
```

You should see:

```json
{"status":"ok"}
```

To list installed printers:

```text
http://127.0.0.1:9876/printers
```
