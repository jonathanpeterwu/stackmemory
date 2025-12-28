#!/bin/bash

# Enhanced Claude Worktree Manager with Sandbox & Chrome Support
# Handles multiple Claude instances with isolation and safety features

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE_SETUP_SCRIPT="${SCRIPT_DIR}/claude-worktree-setup.sh"
CLAUDE_CONFIG_DIR="${HOME}/.claude"
SANDBOX_MODE="${CLAUDE_SANDBOX:-false}"
CHROME_MODE="${CLAUDE_CHROME:-false}"

# Source the main worktree setup
source "$WORKTREE_SETUP_SCRIPT"

# Enhanced ga() function for Claude with worktree support
ga_claude() {
    local branch_base="$1"
    local task="${2:-development}"
    local flags="${3:-}"
    
    if [[ -z "$branch_base" ]]; then
        echo "Usage: ga_claude <branch-name> [task] [flags]"
        echo "Flags: --sandbox, --chrome, --both"
        return 1
    fi
    
    # Parse flags
    local use_sandbox=false
    local use_chrome=false
    
    case "$flags" in
        --sandbox)
            use_sandbox=true
            ;;
        --chrome)
            use_chrome=true
            ;;
        --both)
            use_sandbox=true
            use_chrome=true
            ;;
    esac
    
    # Create the worktree
    claude_worktree_create "$branch_base" "$task"
    
    # Get the created worktree path
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local branch="claude-${branch_base}-${timestamp}-${CLAUDE_INSTANCE_ID}"
    local repo_name="$(basename "$PWD")"
    local worktree_path="${WORKTREE_BASE_DIR}${repo_name}--${branch}"
    
    # Create instance-specific config
    create_instance_config "$worktree_path" "$use_sandbox" "$use_chrome"
    
    # Launch Claude with appropriate flags
    launch_claude_instance "$worktree_path" "$use_sandbox" "$use_chrome"
}

# Enhanced gd() function for Claude worktrees
gd_claude() {
    local current_dir="$(basename "$PWD")"
    
    if [[ "$current_dir" == *"--claude-"* ]]; then
        if gum confirm "Remove Claude worktree and branch?"; then
            local branch="${current_dir#*--}"
            cd ..
            claude_worktree_remove "$branch"
        fi
    else
        echo "Not in a Claude worktree directory"
        return 1
    fi
}

# Create instance-specific configuration
create_instance_config() {
    local worktree_path="$1"
    local use_sandbox="$2"
    local use_chrome="$3"
    
    local config_file="${worktree_path}/.claude-instance.json"
    
    cat > "$config_file" <<EOF
{
    "instance_id": "${CLAUDE_INSTANCE_ID}",
    "worktree_path": "${worktree_path}",
    "sandbox_enabled": ${use_sandbox},
    "chrome_enabled": ${use_chrome},
    "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "restrictions": {
        "file_access": [
            "${worktree_path}/**",
            "${HOME}/.claude/**"
        ],
        "network_access": ${use_sandbox},
        "chrome_automation": ${use_chrome}
    }
}
EOF
    
    echo "Instance config created: $config_file"
}

# Launch Claude instance with appropriate configuration
launch_claude_instance() {
    local worktree_path="$1"
    local use_sandbox="$2"
    local use_chrome="$3"
    
    local claude_cmd="claude"
    local launch_args=""
    
    # Build launch command
    if [[ "$use_sandbox" == "true" ]]; then
        launch_args="${launch_args} --sandbox"
        echo "🔒 Sandbox mode enabled - file and network restrictions active"
    fi
    
    if [[ "$use_chrome" == "true" ]]; then
        launch_args="${launch_args} --chrome"
        echo "🌐 Chrome mode enabled - browser automation available"
    fi
    
    # Set working directory
    cd "$worktree_path"
    
    # Export environment variables
    export CLAUDE_INSTANCE_ID
    export CLAUDE_WORKTREE_PATH="$worktree_path"
    
    echo
    echo "Launching Claude instance:"
    echo "  Working directory: $worktree_path"
    echo "  Instance ID: $CLAUDE_INSTANCE_ID"
    echo "  Command: ${claude_cmd}${launch_args}"
    echo
    
    # Launch Claude (uncomment when ready to use)
    # exec ${claude_cmd}${launch_args}
}

# Monitor active Claude instances
claude_instance_monitor() {
    echo "=== Active Claude Instances ==="
    echo
    
    local instance_count=0
    
    git worktree list --porcelain | while IFS= read -r line; do
        if [[ "$line" == worktree* ]]; then
            local path="${line#worktree }"
            local config_file="${path}/.claude-instance.json"
            
            if [[ -f "$config_file" ]]; then
                ((instance_count++))
                echo "Instance #${instance_count}:"
                
                local instance_id=$(grep '"instance_id"' "$config_file" | cut -d'"' -f4)
                local sandbox=$(grep '"sandbox_enabled"' "$config_file" | cut -d':' -f2 | tr -d ' ,')
                local chrome=$(grep '"chrome_enabled"' "$config_file" | cut -d':' -f2 | tr -d ' ,')
                local created=$(grep '"created"' "$config_file" | cut -d'"' -f4)
                
                echo "  ID: $instance_id"
                echo "  Path: $path"
                echo "  Sandbox: $sandbox"
                echo "  Chrome: $chrome"
                echo "  Created: $created"
                
                # Check for activity (modified files in last hour)
                local recent_files=$(find "$path" -type f -mmin -60 2>/dev/null | wc -l)
                if [[ $recent_files -gt 0 ]]; then
                    echo "  Status: Active (${recent_files} files modified in last hour)"
                else
                    echo "  Status: Idle"
                fi
                echo
            fi
        fi
    done
    
    if [[ $instance_count -eq 0 ]]; then
        echo "No active Claude instances found"
    else
        echo "Total active instances: $instance_count"
    fi
}

# Create isolated sandbox for Claude instance
create_claude_sandbox() {
    local branch_base="$1"
    local sandbox_dir="/tmp/claude-sandbox-${CLAUDE_INSTANCE_ID}"
    
    echo "Creating isolated sandbox at: $sandbox_dir"
    
    # Create sandbox structure
    mkdir -p "$sandbox_dir"/{workspace,config,cache}
    
    # Create sandbox configuration
    cat > "$sandbox_dir/sandbox.conf" <<EOF
# Claude Sandbox Configuration
SANDBOX_ID=${CLAUDE_INSTANCE_ID}
WORKSPACE=${sandbox_dir}/workspace
CONFIG=${sandbox_dir}/config
CACHE=${sandbox_dir}/cache
NETWORK_RESTRICTED=true
FILE_ACCESS_RESTRICTED=true
ALLOWED_PATHS=(
    "${sandbox_dir}/workspace"
    "${HOME}/.claude/readonly"
)
EOF
    
    # Clone repository to sandbox
    git clone . "$sandbox_dir/workspace" --no-hardlinks
    
    # Create worktree in sandbox
    cd "$sandbox_dir/workspace"
    git checkout -b "sandbox-${branch_base}-${CLAUDE_INSTANCE_ID}"
    
    echo "Sandbox created successfully"
    echo "To enter sandbox: cd $sandbox_dir/workspace"
}

# Cleanup sandboxes
cleanup_claude_sandboxes() {
    local days="${1:-1}"
    
    echo "Cleaning up Claude sandboxes older than ${days} days..."
    
    find /tmp -maxdepth 1 -name "claude-sandbox-*" -type d -mtime +${days} -exec rm -rf {} \; 2>/dev/null || true
    
    echo "Sandbox cleanup completed"
}

# Merge work from Claude worktree back to main branch
claude_worktree_merge() {
    local current_branch=$(git rev-parse --abbrev-ref HEAD)
    
    if [[ ! "$current_branch" == claude-* ]]; then
        echo "Not in a Claude worktree branch"
        return 1
    fi
    
    echo "Preparing to merge Claude work back to main branch..."
    
    # Ensure everything is committed
    if [[ -n $(git status --porcelain) ]]; then
        echo "You have uncommitted changes. Please commit them first."
        return 1
    fi
    
    # Interactive rebase to clean up commits
    if gum confirm "Clean up commits before merging?"; then
        git rebase -i origin/main || git rebase -i origin/master
    fi
    
    # Create PR or merge directly
    if gum confirm "Create pull request?"; then
        gh pr create --fill
    else
        # Switch to main branch
        git checkout main || git checkout master
        git merge "$current_branch" --no-ff
        echo "Merged $current_branch to main"
        
        if gum confirm "Delete the Claude worktree?"; then
            claude_worktree_remove "$current_branch"
        fi
    fi
}

# Aliases for convenience
alias cw='claude_worktree_create'
alias cwl='claude_worktree_list'
alias cwr='claude_worktree_remove'
alias cwc='claude_worktree_cleanup'
alias cws='claude_worktree_sync'
alias cwm='claude_worktree_merge'
alias cim='claude_instance_monitor'

# Export functions for use in subshells
export -f ga_claude
export -f gd_claude
export -f claude_worktree_create
export -f claude_worktree_list
export -f claude_worktree_remove
export -f claude_worktree_cleanup
export -f claude_worktree_sync
export -f claude_worktree_merge
export -f claude_instance_monitor
export -f create_claude_sandbox
export -f cleanup_claude_sandboxes

# Show help if no arguments
if [[ "$#" -eq 0 ]]; then
    echo "Claude Worktree Manager with Sandbox & Chrome Support"
    echo
    echo "Quick Start:"
    echo "  ga_claude <branch> [task] [--sandbox|--chrome|--both]"
    echo "  gd_claude                  - Remove current Claude worktree"
    echo
    echo "Commands:"
    echo "  cw <branch> [task]         - Create worktree"
    echo "  cwl                        - List worktrees"
    echo "  cwr [branch]               - Remove worktree"
    echo "  cwc [days]                 - Cleanup old worktrees"
    echo "  cws                        - Sync with main"
    echo "  cwm                        - Merge back to main"
    echo "  cim                        - Monitor instances"
    echo
    echo "Sandbox Commands:"
    echo "  create_claude_sandbox <branch>  - Create isolated sandbox"
    echo "  cleanup_claude_sandboxes [days] - Clean old sandboxes"
    echo
    echo "Examples:"
    echo "  ga_claude feature-auth 'Add authentication' --sandbox"
    echo "  ga_claude ui-update 'Update UI components' --chrome"
    echo "  ga_claude complex-task 'Major refactor' --both"
fi