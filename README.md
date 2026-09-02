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

Credits to [mttbernardini/fullscreen-to-workspace](https://github.com/mttbernardini/fullscreen-to-workspace) for inspiration, and Proton's Lumo AI for writing all the js.   


>Small props to Brave's Leo AI for coming up with one function slightly more robust than what Lumo did; I carried that over from [my old version of this extension](https://github.com/Ao1Pointblank/fullscreen-to-workspace).  
(i opted to keep ``_isFull`` window geometry check as a fallback if ``is_fullscreen()`` fails. this combination puts me slightly over my preferred 200 line max budget but i think it is worth it)
