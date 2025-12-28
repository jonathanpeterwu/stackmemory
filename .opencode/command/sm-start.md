---
description: Start a new StackMemory task frame
---

Start a new task frame in StackMemory using the `start_frame` tool:

Task: $ARGUMENTS

This creates a scoped unit of work on the call stack. All subsequent context will be associated with this frame until it's closed.

Confirm the frame was started and show the frame ID.
