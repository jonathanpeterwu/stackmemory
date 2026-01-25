#!/usr/bin/env zsh
# StackMemory Sweep Completion for ZSH
# Non-intrusive: shows context in RPROMPT, no input hijacking

# Configuration
SWEEP_COMPLETE_ENABLED=${SWEEP_COMPLETE_ENABLED:-true}
SWEEP_STATE_FILE="${HOME}/.stackmemory/sweep-state.json"
SWEEP_SUGGEST_SCRIPT="${HOME}/.stackmemory/shell/sweep-suggest.js"

# State
typeset -g _sweep_suggestion=""
typeset -g _sweep_last_check=0

# Get suggestion (called on-demand only)
_sweep_get_suggestion() {
    [[ "$SWEEP_COMPLETE_ENABLED" != "true" ]] && return 1
    [[ ${#BUFFER} -lt 3 ]] && return 1

    if [[ -f "$SWEEP_SUGGEST_SCRIPT" ]]; then
        _sweep_suggestion=$(echo "$BUFFER" | timeout 0.5 node "$SWEEP_SUGGEST_SCRIPT" 2>/dev/null)
        [[ -n "$_sweep_suggestion" ]] && return 0
    fi
    return 1
}

# Accept current suggestion
_sweep_accept() {
    if [[ -n "$_sweep_suggestion" ]]; then
        BUFFER="${BUFFER}${_sweep_suggestion}"
        CURSOR=${#BUFFER}
        _sweep_suggestion=""
        RPROMPT="$_sweep_saved_rprompt"
        zle redisplay
    else
        # Fall through to normal tab completion
        zle expand-or-complete
    fi
}

# Request suggestion manually (Ctrl+])
_sweep_request() {
    if _sweep_get_suggestion; then
        _sweep_saved_rprompt="$RPROMPT"
        RPROMPT="%F{240}[${_sweep_suggestion}]%f"
        zle redisplay
    else
        zle -M "No suggestion available"
    fi
}

# Clear suggestion
_sweep_clear() {
    _sweep_suggestion=""
    RPROMPT="$_sweep_saved_rprompt"
}

# Widget definitions
zle -N sweep-accept _sweep_accept
zle -N sweep-request _sweep_request
zle -N sweep-clear _sweep_clear

# Key bindings - ONLY these, no input hijacking
bindkey '^[[Z' sweep-request    # Shift+Tab to request suggestion
bindkey '^I' sweep-accept       # Tab to accept (falls through to normal completion if no suggestion)

# Show recent file context in RPROMPT (passive, after each command)
_sweep_show_context() {
    [[ "$SWEEP_COMPLETE_ENABLED" != "true" ]] && return

    if [[ -f "$SWEEP_STATE_FILE" ]]; then
        local recent_file=$(grep -o '"file_path":"[^"]*"' "$SWEEP_STATE_FILE" 2>/dev/null | head -1 | cut -d'"' -f4)
        if [[ -n "$recent_file" ]]; then
            local filename=$(basename "$recent_file")
            _sweep_saved_rprompt="%F{240}[${filename}]%f"
            RPROMPT="$_sweep_saved_rprompt"
        fi
    fi
}

# Hook into prompt refresh (runs after each command, not during typing)
autoload -Uz add-zsh-hook
add-zsh-hook precmd _sweep_show_context

# Status
sweep_status() {
    echo "Sweep Shell Integration"
    echo "  Enabled: $SWEEP_COMPLETE_ENABLED"
    echo "  Current suggestion: ${_sweep_suggestion:-none}"
    echo ""
    if [[ -f "$SWEEP_STATE_FILE" ]]; then
        local count=$(grep -c '"file_path"' "$SWEEP_STATE_FILE" 2>/dev/null || echo 0)
        echo "  Recent edits tracked: $count"
    fi
    echo ""
    echo "Usage:"
    echo "  Shift+Tab  Request suggestion based on input"
    echo "  Tab        Accept suggestion (or normal completion)"
    echo ""
    echo "The right prompt shows your most recently edited file."
}

# Toggle
sweep_toggle() {
    if [[ "$SWEEP_COMPLETE_ENABLED" == "true" ]]; then
        SWEEP_COMPLETE_ENABLED=false
        RPROMPT=""
        echo "Sweep disabled"
    else
        SWEEP_COMPLETE_ENABLED=true
        _sweep_show_context
        echo "Sweep enabled"
    fi
}

alias sweep-on='SWEEP_COMPLETE_ENABLED=true; _sweep_show_context; echo "Sweep enabled"'
alias sweep-off='SWEEP_COMPLETE_ENABLED=false; RPROMPT=""; echo "Sweep disabled"'
