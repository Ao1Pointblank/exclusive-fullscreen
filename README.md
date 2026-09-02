# Fullscreen Workspaces for Cinnamon

Each fullscreen app automatically gets its own exclusive workspace.

What It Does

  - Fullscreen any app:         Creates a new workspace named after that program and moves the window there, while you stay on your current workspace
  - Exit fullscreen:            Returns the window to your original workspace and cleans up the generated one
  - Multiple fullscreen apps:   Each gets its own dedicated workspace (they never share)
  - Other windows stay put:     Regular windows are never pulled into fullscreen-only workspaces

Requirements

  - Cinnamon Desktop Environment (Linux Mint, Debian, Fedora, etc.)
  - No special setup (just install into ``~/.local/share/cinnamon/extensions/exclusive-fullscreen@pointblank`` and toggle on)

Credits to [mttbernardini/fullscreen-to-workspace](https://github.com/mttbernardini/fullscreen-to-workspace) for inspiration, and Proton's Lumo AI for writing all 198 lines of js
