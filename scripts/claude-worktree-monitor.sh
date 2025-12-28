#!/bin/bash

# Claude Worktree Monitor & Cleanup Service
# Monitors active worktrees, manages resources, and prevents conflicts

set -e

# Configuration
MONITOR_INTERVAL="${CLAUDE_MONITOR_INTERVAL:-300}" # 5 minutes
LOG_DIR="${HOME}/.claude/logs"
LOCK_DIR=".claude-worktree-locks"
MAX_ACTIVE_WORKTREES="${MAX_ACTIVE_WORKTREES:-5}"
AUTO_CLEANUP_DAYS="${AUTO_CLEANUP_DAYS:-7}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Initialize logging
init_logging() {
    mkdir -p "$LOG_DIR"
    local log_file="${LOG_DIR}/monitor-$(date +%Y%m%d).log"
    exec 1> >(tee -a "$log_file")
    exec 2>&1
}

# Log with timestamp
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check worktree health
check_worktree_health() {
    local worktree_path="$1"
    local branch="$2"
    local health_status="healthy"
    local issues=()
    
    # Check if directory exists
    if [[ ! -d "$worktree_path" ]]; then
        issues+=("Directory missing")
        health_status="critical"
        return 1
    fi
    
    cd "$worktree_path" 2>/dev/null || {
        issues+=("Cannot access directory")
        health_status="critical"
        return 1
    }
    
    # Check git status
    if ! git status &>/dev/null; then
        issues+=("Git repository corrupted")
        health_status="critical"
    fi
    
    # Check for merge conflicts
    if git diff --name-only --diff-filter=U | grep -q .; then
        issues+=("Has merge conflicts")
        health_status="warning"
    fi
    
    # Check disk usage
    local disk_usage=$(du -sh . 2>/dev/null | cut -f1)
    local disk_usage_mb=$(du -sm . 2>/dev/null | cut -f1)
    if [[ $disk_usage_mb -gt 1000 ]]; then
        issues+=("High disk usage: ${disk_usage}")
        health_status="warning"
    fi
    
    # Check for stale lock files
    local lock_file="${LOCK_DIR}/${branch}.lock"
    if [[ -f "$lock_file" ]]; then
        local lock_age_hours=$(( ($(date +%s) - $(stat -f %m "$lock_file" 2>/dev/null || stat -c %Y "$lock_file" 2>/dev/null)) / 3600 ))
        if [[ $lock_age_hours -gt 24 ]]; then
            issues+=("Stale lock file (${lock_age_hours}h old)")
            health_status="warning"
        fi
    fi
    
    # Return health report
    if [[ ${#issues[@]} -gt 0 ]]; then
        echo -e "${YELLOW}Health: ${health_status}${NC}"
        for issue in "${issues[@]}"; do
            echo "  - $issue"
        done
    else
        echo -e "${GREEN}Health: healthy${NC}"
    fi
    
    cd - > /dev/null
}

# Monitor active worktrees
monitor_worktrees() {
    log_message "Starting worktree monitoring cycle"
    
    local active_count=0
    local total_disk_usage=0
    local worktree_data=()
    
    echo -e "${BLUE}=== Claude Worktree Status ===${NC}"
    echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
    echo
    
    # Collect worktree information
    git worktree list --porcelain | while IFS= read -r line; do
        if [[ "$line" == worktree* ]]; then
            local path="${line#worktree }"
            local dirname="$(basename "$path")"
            
            # Check if this is a Claude worktree
            if [[ "$dirname" == *"--claude-"* ]]; then
                ((active_count++))
                local branch="${dirname#*--}"
                
                echo -e "${YELLOW}Worktree ${active_count}: ${dirname}${NC}"
                echo "  Path: $path"
                
                # Check health
                check_worktree_health "$path" "$branch"
                
                # Check activity
                if [[ -d "$path" ]]; then
                    local last_modified=$(find "$path" -type f -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | xargs stat -f %m 2>/dev/null | sort -n | tail -1)
                    if [[ -n "$last_modified" ]]; then
                        local age_minutes=$(( ($(date +%s) - $last_modified) / 60 ))
                        if [[ $age_minutes -lt 60 ]]; then
                            echo -e "  Activity: ${GREEN}Active (${age_minutes}m ago)${NC}"
                        elif [[ $age_minutes -lt 1440 ]]; then
                            echo -e "  Activity: ${YELLOW}Idle ($(( age_minutes / 60 ))h ago)${NC}"
                        else
                            echo -e "  Activity: ${RED}Stale ($(( age_minutes / 1440 ))d ago)${NC}"
                        fi
                    fi
                    
                    # Disk usage
                    local disk_mb=$(du -sm "$path" 2>/dev/null | cut -f1)
                    total_disk_usage=$((total_disk_usage + disk_mb))
                    echo "  Disk usage: ${disk_mb}MB"
                fi
                echo
            fi
        fi
    done
    
    # Summary
    echo -e "${BLUE}=== Summary ===${NC}"
    echo "Active worktrees: $active_count / $MAX_ACTIVE_WORKTREES"
    echo "Total disk usage: ${total_disk_usage}MB"
    
    # Warnings
    if [[ $active_count -ge $MAX_ACTIVE_WORKTREES ]]; then
        echo -e "${RED}WARNING: Maximum worktree limit reached!${NC}"
        echo "Consider running: ./claude-worktree-cleanup.sh"
    fi
    
    if [[ $total_disk_usage -gt 5000 ]]; then
        echo -e "${YELLOW}WARNING: High total disk usage (${total_disk_usage}MB)${NC}"
    fi
    
    log_message "Monitoring cycle completed: ${active_count} active worktrees, ${total_disk_usage}MB total"
}

# Auto-cleanup old worktrees
auto_cleanup() {
    log_message "Running auto-cleanup for worktrees older than ${AUTO_CLEANUP_DAYS} days"
    
    local cleaned_count=0
    
    git worktree list --porcelain | while IFS= read -r line; do
        if [[ "$line" == worktree* ]]; then
            local path="${line#worktree }"
            local dirname="$(basename "$path")"
            
            if [[ "$dirname" == *"--claude-"* ]]; then
                local branch="${dirname#*--}"
                local lock_file="${LOCK_DIR}/${branch}.lock"
                
                # Check age
                if [[ -f "$lock_file" ]]; then
                    local created=$(grep '"created"' "$lock_file" | cut -d'"' -f4)
                    local created_timestamp=$(date -d "$created" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$created" +%s 2>/dev/null)
                    local current_timestamp=$(date +%s)
                    local age_days=$(( (current_timestamp - created_timestamp) / 86400 ))
                    
                    if [[ $age_days -gt $AUTO_CLEANUP_DAYS ]]; then
                        # Check if idle
                        local last_modified=$(find "$path" -type f -newer "$lock_file" 2>/dev/null | head -1)
                        if [[ -z "$last_modified" ]]; then
                            log_message "Auto-removing old idle worktree: $dirname (${age_days} days old)"
                            git worktree remove "$path" --force 2>/dev/null && ((cleaned_count++))
                            rm -f "$lock_file"
                        fi
                    fi
                fi
            fi
        fi
    done
    
    if [[ $cleaned_count -gt 0 ]]; then
        log_message "Auto-cleanup completed: removed ${cleaned_count} old worktrees"
    fi
}

# Conflict detection
detect_conflicts() {
    local conflicts=()
    local branches=()
    
    # Collect all Claude branches
    git worktree list --porcelain | while IFS= read -r line; do
        if [[ "$line" == branch* ]] && [[ "$line" == *"claude-"* ]]; then
            branches+=("${line#branch refs/heads/}")
        fi
    done
    
    # Check for potential conflicts
    for ((i=0; i<${#branches[@]}; i++)); do
        for ((j=i+1; j<${#branches[@]}; j++)); do
            local branch1="${branches[i]}"
            local branch2="${branches[j]}"
            
            # Check if branches modify same files
            local common_files=$(comm -12 \
                <(git diff --name-only "origin/main...$branch1" 2>/dev/null | sort) \
                <(git diff --name-only "origin/main...$branch2" 2>/dev/null | sort))
            
            if [[ -n "$common_files" ]]; then
                conflicts+=("${branch1} ↔ ${branch2}: $(echo "$common_files" | wc -l) common files")
            fi
        done
    done
    
    if [[ ${#conflicts[@]} -gt 0 ]]; then
        echo -e "${RED}=== Potential Conflicts Detected ===${NC}"
        for conflict in "${conflicts[@]}"; do
            echo "  - $conflict"
        done
        echo
    fi
}

# Resource usage report
resource_report() {
    echo -e "${BLUE}=== Resource Usage Report ===${NC}"
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo
    
    # CPU usage by git processes
    local git_cpu=$(ps aux | grep '[g]it' | awk '{sum+=$3} END {print sum}')
    echo "Git processes CPU usage: ${git_cpu:-0}%"
    
    # Memory usage
    local git_mem=$(ps aux | grep '[g]it' | awk '{sum+=$4} END {print sum}')
    echo "Git processes memory usage: ${git_mem:-0}%"
    
    # Disk I/O (if iostat available)
    if command -v iostat &>/dev/null; then
        echo "Disk I/O:"
        iostat -d 1 2 | tail -n +4 | head -2
    fi
    
    # Network connections (git remote operations)
    local git_connections=$(netstat -an 2>/dev/null | grep -c ':22\|:443' || echo "0")
    echo "Active git network connections: $git_connections"
    echo
}

# Daemon mode
run_daemon() {
    log_message "Starting Claude Worktree Monitor daemon (PID: $$)"
    
    # Create PID file
    echo $$ > "${HOME}/.claude/monitor.pid"
    
    # Trap signals for clean shutdown
    trap 'log_message "Daemon shutting down"; rm -f "${HOME}/.claude/monitor.pid"; exit 0' SIGTERM SIGINT
    
    while true; do
        monitor_worktrees
        detect_conflicts
        resource_report
        
        # Run auto-cleanup once per day
        if [[ $(date +%H:%M) == "03:00" ]]; then
            auto_cleanup
        fi
        
        sleep "$MONITOR_INTERVAL"
    done
}

# Stop daemon
stop_daemon() {
    if [[ -f "${HOME}/.claude/monitor.pid" ]]; then
        local pid=$(cat "${HOME}/.claude/monitor.pid")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            echo "Monitor daemon stopped (PID: $pid)"
        else
            echo "Monitor daemon not running"
        fi
        rm -f "${HOME}/.claude/monitor.pid"
    else
        echo "No monitor daemon found"
    fi
}

# Main command handler
main() {
    local command="${1:-monitor}"
    
    case "$command" in
        monitor)
            monitor_worktrees
            detect_conflicts
            ;;
        daemon|start)
            if [[ -f "${HOME}/.claude/monitor.pid" ]] && kill -0 "$(cat "${HOME}/.claude/monitor.pid")" 2>/dev/null; then
                echo "Monitor daemon already running (PID: $(cat "${HOME}/.claude/monitor.pid"))"
            else
                init_logging
                run_daemon &
                echo "Monitor daemon started (PID: $!)"
            fi
            ;;
        stop)
            stop_daemon
            ;;
        status)
            if [[ -f "${HOME}/.claude/monitor.pid" ]] && kill -0 "$(cat "${HOME}/.claude/monitor.pid")" 2>/dev/null; then
                echo "Monitor daemon running (PID: $(cat "${HOME}/.claude/monitor.pid"))"
            else
                echo "Monitor daemon not running"
            fi
            ;;
        cleanup)
            auto_cleanup
            ;;
        report)
            resource_report
            ;;
        conflicts)
            detect_conflicts
            ;;
        *)
            echo "Claude Worktree Monitor"
            echo
            echo "Usage: $0 [command]"
            echo
            echo "Commands:"
            echo "  monitor   - Run monitoring check once (default)"
            echo "  daemon    - Start monitoring daemon"
            echo "  stop      - Stop monitoring daemon"
            echo "  status    - Check daemon status"
            echo "  cleanup   - Run auto-cleanup"
            echo "  report    - Generate resource report"
            echo "  conflicts - Detect potential conflicts"
            ;;
    esac
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi