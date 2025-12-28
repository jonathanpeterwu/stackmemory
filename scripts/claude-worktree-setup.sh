#!/bin/bash

# Claude-specific Git Worktree Management for Multiple Instances
# Prevents conflicts when multiple Claude instances work on the same repository

set -e

# Configuration
WORKTREE_BASE_DIR="${WORKTREE_BASE_DIR:-../}"
CLAUDE_INSTANCE_ID="${CLAUDE_INSTANCE_ID:-$(uuidgen | cut -c1-8)}"
LOCK_DIR=".claude-worktree-locks"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Initialize lock directory
init_locks() {
    mkdir -p "$LOCK_DIR"
}

# Create a Claude-specific worktree with instance isolation
claude_worktree_create() {
    local branch_base="$1"
    local task_desc="${2:-work}"
    
    if [[ -z "$branch_base" ]]; then
        echo -e "${RED}Usage: claude_worktree_create <branch-name-base> [task-description]${NC}"
        return 1
    fi
    
    # Generate unique branch name with timestamp and instance ID
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local branch="claude-${branch_base}-${timestamp}-${CLAUDE_INSTANCE_ID}"
    local repo_name="$(basename "$PWD")"
    local worktree_path="${WORKTREE_BASE_DIR}${repo_name}--${branch}"
    
    # Create lock file
    init_locks
    local lock_file="${LOCK_DIR}/${branch}.lock"
    
    # Check if branch already exists
    if git show-ref --verify --quiet "refs/heads/${branch}"; then
        echo -e "${YELLOW}Branch ${branch} already exists, using existing branch${NC}"
        git worktree add "$worktree_path" "$branch"
    else
        echo -e "${GREEN}Creating worktree: ${worktree_path}${NC}"
        echo -e "${GREEN}Branch: ${branch}${NC}"
        git worktree add -b "$branch" "$worktree_path"
    fi
    
    # Write lock information
    cat > "$lock_file" <<EOF
{
    "instance_id": "${CLAUDE_INSTANCE_ID}",
    "branch": "${branch}",
    "path": "${worktree_path}",
    "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "task": "${task_desc}",
    "pid": "$$"
}
EOF
    
    # Copy environment files if they exist
    for file in .env .env.local .mise.toml .tool-versions; do
        if [[ -f "$file" ]]; then
            cp "$file" "$worktree_path/" 2>/dev/null || true
        fi
    done
    
    # Trust the directory if mise is available
    if command -v mise &> /dev/null; then
        mise trust "$worktree_path" 2>/dev/null || true
    fi
    
    echo -e "${GREEN}Worktree created successfully!${NC}"
    echo "Path: $worktree_path"
    echo "Branch: $branch"
    echo "Instance ID: $CLAUDE_INSTANCE_ID"
    echo
    echo "To switch to this worktree:"
    echo "  cd $worktree_path"
}

# List all Claude worktrees with status
claude_worktree_list() {
    echo -e "${GREEN}=== Claude Worktrees ===${NC}"
    echo
    
    git worktree list --porcelain | while IFS= read -r line; do
        if [[ "$line" == worktree* ]]; then
            local path="${line#worktree }"
            local dirname="$(basename "$path")"
            
            # Check if this is a Claude worktree
            if [[ "$dirname" == *"--claude-"* ]]; then
                echo -e "${YELLOW}Worktree: ${dirname}${NC}"
                echo "  Path: $path"
                
                # Read lock file if exists
                local branch="${dirname#*--}"
                local lock_file="${LOCK_DIR}/${branch}.lock"
                if [[ -f "$lock_file" ]]; then
                    local instance_id=$(grep '"instance_id"' "$lock_file" | cut -d'"' -f4)
                    local task=$(grep '"task"' "$lock_file" | cut -d'"' -f4)
                    local created=$(grep '"created"' "$lock_file" | cut -d'"' -f4)
                    echo "  Instance: $instance_id"
                    echo "  Task: $task"
                    echo "  Created: $created"
                fi
                
                # Check for uncommitted changes
                if cd "$path" 2>/dev/null; then
                    if [[ -n $(git status --porcelain) ]]; then
                        echo -e "  Status: ${RED}Has uncommitted changes${NC}"
                    else
                        echo -e "  Status: ${GREEN}Clean${NC}"
                    fi
                    cd - > /dev/null
                fi
                echo
            fi
        fi
    done
}

# Remove a Claude worktree safely
claude_worktree_remove() {
    local branch="$1"
    
    if [[ -z "$branch" ]]; then
        # Try to detect from current directory
        local current_dir="$(basename "$PWD")"
        if [[ "$current_dir" == *"--claude-"* ]]; then
            branch="${current_dir#*--}"
        else
            echo -e "${RED}Usage: claude_worktree_remove <branch-name>${NC}"
            echo "Or run from within a Claude worktree directory"
            return 1
        fi
    fi
    
    # Find worktree path
    local worktree_path
    worktree_path=$(git worktree list --porcelain | grep -B1 "branch refs/heads/${branch}" | grep "^worktree" | cut -d' ' -f2)
    
    if [[ -z "$worktree_path" ]]; then
        echo -e "${RED}Worktree for branch ${branch} not found${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}Removing worktree: ${worktree_path}${NC}"
    echo -e "${YELLOW}Branch: ${branch}${NC}"
    
    # Check for uncommitted changes
    if cd "$worktree_path" 2>/dev/null; then
        if [[ -n $(git status --porcelain) ]]; then
            echo -e "${RED}Warning: Worktree has uncommitted changes!${NC}"
            read -p "Continue anyway? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                return 1
            fi
        fi
        cd - > /dev/null
    fi
    
    # Remove worktree and branch
    git worktree remove "$worktree_path" --force
    git branch -D "$branch" 2>/dev/null || true
    
    # Remove lock file
    rm -f "${LOCK_DIR}/${branch}.lock"
    
    echo -e "${GREEN}Worktree removed successfully${NC}"
}

# Clean up old Claude worktrees
claude_worktree_cleanup() {
    local days="${1:-7}"
    echo -e "${YELLOW}Cleaning up Claude worktrees older than ${days} days...${NC}"
    
    local count=0
    git worktree list --porcelain | while IFS= read -r line; do
        if [[ "$line" == worktree* ]]; then
            local path="${line#worktree }"
            local dirname="$(basename "$path")"
            
            # Check if this is a Claude worktree
            if [[ "$dirname" == *"--claude-"* ]]; then
                local branch="${dirname#*--}"
                local lock_file="${LOCK_DIR}/${branch}.lock"
                
                if [[ -f "$lock_file" ]]; then
                    local created=$(grep '"created"' "$lock_file" | cut -d'"' -f4)
                    local created_timestamp=$(date -d "$created" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$created" +%s 2>/dev/null)
                    local current_timestamp=$(date +%s)
                    local age_days=$(( (current_timestamp - created_timestamp) / 86400 ))
                    
                    if [[ $age_days -gt $days ]]; then
                        echo "  Removing old worktree: $dirname (${age_days} days old)"
                        claude_worktree_remove "$branch"
                        ((count++))
                    fi
                fi
            fi
        fi
    done
    
    echo -e "${GREEN}Cleaned up ${count} old worktrees${NC}"
}

# Sync worktree with main branch
claude_worktree_sync() {
    local current_branch=$(git rev-parse --abbrev-ref HEAD)
    
    if [[ ! "$current_branch" == claude-* ]]; then
        echo -e "${RED}Not in a Claude worktree branch${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}Syncing with main branch...${NC}"
    
    # Stash any local changes
    local stash_result=$(git stash)
    
    # Fetch and merge/rebase with main
    git fetch origin
    git rebase origin/main || git rebase origin/master || {
        echo -e "${RED}Failed to rebase. You may need to resolve conflicts.${NC}"
        if [[ "$stash_result" != "No local changes to save" ]]; then
            git stash pop
        fi
        return 1
    }
    
    # Pop stash if we stashed anything
    if [[ "$stash_result" != "No local changes to save" ]]; then
        git stash pop
    fi
    
    echo -e "${GREEN}Sync completed successfully${NC}"
}

# Helper function to switch to a Claude worktree
claude_worktree_switch() {
    local pattern="$1"
    
    if [[ -z "$pattern" ]]; then
        echo -e "${RED}Usage: claude_worktree_switch <pattern>${NC}"
        echo "Pattern can be part of branch name or instance ID"
        return 1
    fi
    
    local matches=()
    git worktree list --porcelain | while IFS= read -r line; do
        if [[ "$line" == worktree* ]]; then
            local path="${line#worktree }"
            local dirname="$(basename "$path")"
            
            if [[ "$dirname" == *"claude"*"$pattern"* ]]; then
                matches+=("$path")
                echo "Found: $path"
            fi
        fi
    done
    
    if [[ ${#matches[@]} -eq 1 ]]; then
        cd "${matches[0]}"
        echo -e "${GREEN}Switched to: ${matches[0]}${NC}"
    elif [[ ${#matches[@]} -gt 1 ]]; then
        echo -e "${YELLOW}Multiple matches found. Please be more specific.${NC}"
    else
        echo -e "${RED}No matching worktree found${NC}"
    fi
}

# Main function for CLI usage
main() {
    local command="$1"
    shift
    
    case "$command" in
        create|add)
            claude_worktree_create "$@"
            ;;
        list|ls)
            claude_worktree_list
            ;;
        remove|rm)
            claude_worktree_remove "$@"
            ;;
        cleanup|clean)
            claude_worktree_cleanup "$@"
            ;;
        sync)
            claude_worktree_sync
            ;;
        switch|cd)
            claude_worktree_switch "$@"
            ;;
        *)
            echo "Claude Worktree Manager for Multiple Instances"
            echo
            echo "Usage: $0 <command> [options]"
            echo
            echo "Commands:"
            echo "  create <branch-base> [task]  - Create a new Claude worktree"
            echo "  list                         - List all Claude worktrees"
            echo "  remove [branch]              - Remove a Claude worktree"
            echo "  cleanup [days]               - Remove old worktrees (default: 7 days)"
            echo "  sync                         - Sync current worktree with main branch"
            echo "  switch <pattern>             - Switch to a Claude worktree"
            echo
            echo "Environment Variables:"
            echo "  CLAUDE_INSTANCE_ID    - Unique ID for this Claude instance"
            echo "  WORKTREE_BASE_DIR     - Base directory for worktrees (default: ../)"
            ;;
    esac
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi