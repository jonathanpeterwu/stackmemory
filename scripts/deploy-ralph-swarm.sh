#!/bin/bash

# Ralph Swarm Deployment Script
# Ensures parallel execution and monitoring capabilities

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SWARM_DIR="$PROJECT_ROOT/.swarm"
SWARM_LOGS="$SWARM_DIR/logs"
SWARM_PIDS="$SWARM_DIR/pids"
SWARM_STATUS="$SWARM_DIR/status"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ensure directories exist
mkdir -p "$SWARM_LOGS" "$SWARM_PIDS" "$SWARM_STATUS"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[SWARM]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    # Check if project is built
    if [ ! -d "$PROJECT_ROOT/dist" ]; then
        print_warning "Project not built. Building now..."
        cd "$PROJECT_ROOT"
        npm run build
    fi
    
    # Check database connection
    if [ -z "$DATABASE_URL" ] && [ ! -f "$HOME/.stackmemory/projects.db" ]; then
        print_warning "No database configured. Using SQLite fallback."
        export DATABASE_URL="sqlite://$HOME/.stackmemory/projects.db"
    fi
    
    print_status "Prerequisites check complete"
}

# Function to initialize swarm environment
initialize_swarm() {
    print_status "Initializing swarm environment..."
    
    # Create swarm configuration
    cat > "$SWARM_DIR/config.json" <<EOF
{
    "maxAgents": 10,
    "coordinationInterval": 30000,
    "driftDetectionThreshold": 5,
    "freshStartInterval": 3600000,
    "conflictResolutionStrategy": "expertise",
    "enableDynamicPlanning": true,
    "pathologicalBehaviorDetection": true,
    "parallelExecution": true,
    "monitoring": {
        "enabled": true,
        "port": 3456,
        "metricsInterval": 5000
    }
}
EOF
    
    print_status "Swarm configuration created"
}

# Function to launch swarm with project
launch_swarm() {
    local project="$1"
    local agents="${2:-architect,developer,tester,reviewer}"
    local max_agents="${3:-5}"
    
    print_status "Launching swarm for project: $project"
    print_info "Agents: $agents"
    print_info "Max agents: $max_agents"
    
    # Generate swarm ID
    local swarm_id="swarm-$(date +%Y%m%d-%H%M%S)-$$"
    local log_file="$SWARM_LOGS/$swarm_id.log"
    local pid_file="$SWARM_PIDS/$swarm_id.pid"
    
    # Launch swarm in background
    nohup node "$PROJECT_ROOT/dist/cli/index.js" ralph swarm \
        "$project" \
        --agents "$agents" \
        --max-agents "$max_agents" \
        > "$log_file" 2>&1 &
    
    local pid=$!
    echo $pid > "$pid_file"
    
    # Store swarm metadata
    cat > "$SWARM_STATUS/$swarm_id.json" <<EOF
{
    "id": "$swarm_id",
    "pid": $pid,
    "project": "$project",
    "agents": "$agents",
    "maxAgents": $max_agents,
    "startTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "status": "running",
    "logFile": "$log_file"
}
EOF
    
    print_status "Swarm launched with ID: $swarm_id (PID: $pid)"
    echo "$swarm_id"
}

# Function to launch parallel swarms
launch_parallel_swarms() {
    print_status "Launching parallel swarms..."
    
    local swarm_ids=()
    
    # Swarm 1: Architecture and design
    swarm_ids+=("$(launch_swarm "Design system architecture" "architect,developer" 3)")
    sleep 2
    
    # Swarm 2: Core implementation
    swarm_ids+=("$(launch_swarm "Implement core features" "developer,tester" 4)")
    sleep 2
    
    # Swarm 3: Testing and quality
    swarm_ids+=("$(launch_swarm "Create comprehensive test suite" "tester,reviewer" 3)")
    sleep 2
    
    # Swarm 4: Documentation
    swarm_ids+=("$(launch_swarm "Generate documentation" "documenter,developer" 2)")
    
    print_status "Launched ${#swarm_ids[@]} parallel swarms"
    
    # Return swarm IDs for monitoring
    echo "${swarm_ids[@]}"
}

# Function to monitor swarm status
monitor_swarm() {
    local swarm_id="$1"
    
    if [ ! -f "$SWARM_STATUS/$swarm_id.json" ]; then
        print_error "Swarm $swarm_id not found"
        return 1
    fi
    
    local pid=$(jq -r '.pid' "$SWARM_STATUS/$swarm_id.json")
    local project=$(jq -r '.project' "$SWARM_STATUS/$swarm_id.json")
    local log_file=$(jq -r '.logFile' "$SWARM_STATUS/$swarm_id.json")
    
    if ps -p $pid > /dev/null 2>&1; then
        print_status "Swarm $swarm_id (PID: $pid) is RUNNING"
        print_info "Project: $project"
        print_info "Recent logs:"
        tail -n 5 "$log_file" | sed 's/^/    /'
    else
        print_warning "Swarm $swarm_id (PID: $pid) has STOPPED"
        # Update status
        jq '.status = "stopped"' "$SWARM_STATUS/$swarm_id.json" > "$SWARM_STATUS/$swarm_id.json.tmp"
        mv "$SWARM_STATUS/$swarm_id.json.tmp" "$SWARM_STATUS/$swarm_id.json"
    fi
}

# Function to monitor all active swarms
monitor_all_swarms() {
    print_status "Monitoring all active swarms..."
    
    for status_file in "$SWARM_STATUS"/*.json; do
        if [ -f "$status_file" ]; then
            local swarm_id=$(basename "$status_file" .json)
            monitor_swarm "$swarm_id"
            echo ""
        fi
    done
}

# Function to stop swarm
stop_swarm() {
    local swarm_id="$1"
    
    if [ ! -f "$SWARM_PIDS/$swarm_id.pid" ]; then
        print_error "Swarm $swarm_id not found"
        return 1
    fi
    
    local pid=$(cat "$SWARM_PIDS/$swarm_id.pid")
    
    if ps -p $pid > /dev/null 2>&1; then
        print_status "Stopping swarm $swarm_id (PID: $pid)..."
        kill -TERM $pid
        sleep 2
        
        # Force kill if still running
        if ps -p $pid > /dev/null 2>&1; then
            print_warning "Force stopping swarm $swarm_id..."
            kill -KILL $pid
        fi
        
        print_status "Swarm $swarm_id stopped"
    else
        print_info "Swarm $swarm_id is not running"
    fi
    
    # Update status
    if [ -f "$SWARM_STATUS/$swarm_id.json" ]; then
        jq '.status = "stopped"' "$SWARM_STATUS/$swarm_id.json" > "$SWARM_STATUS/$swarm_id.json.tmp"
        mv "$SWARM_STATUS/$swarm_id.json.tmp" "$SWARM_STATUS/$swarm_id.json"
    fi
}

# Function to clean up old swarms
cleanup_swarms() {
    print_status "Cleaning up old swarm data..."
    
    local count=0
    for status_file in "$SWARM_STATUS"/*.json; do
        if [ -f "$status_file" ]; then
            local status=$(jq -r '.status' "$status_file")
            if [ "$status" = "stopped" ]; then
                local swarm_id=$(basename "$status_file" .json)
                rm -f "$status_file"
                rm -f "$SWARM_PIDS/$swarm_id.pid"
                count=$((count + 1))
            fi
        fi
    done
    
    print_status "Cleaned up $count stopped swarms"
}

# Function to show swarm dashboard
show_dashboard() {
    clear
    echo "========================================"
    echo "       RALPH SWARM DASHBOARD"
    echo "========================================"
    echo ""
    
    local running=0
    local stopped=0
    local total=0
    
    for status_file in "$SWARM_STATUS"/*.json; do
        if [ -f "$status_file" ]; then
            total=$((total + 1))
            local status=$(jq -r '.status' "$status_file")
            if [ "$status" = "running" ]; then
                running=$((running + 1))
            else
                stopped=$((stopped + 1))
            fi
        fi
    done
    
    echo "Total Swarms: $total"
    echo "Running: $running"
    echo "Stopped: $stopped"
    echo ""
    echo "----------------------------------------"
    echo "Active Swarms:"
    echo "----------------------------------------"
    
    for status_file in "$SWARM_STATUS"/*.json; do
        if [ -f "$status_file" ]; then
            local status=$(jq -r '.status' "$status_file")
            if [ "$status" = "running" ]; then
                local swarm_id=$(basename "$status_file" .json)
                local project=$(jq -r '.project' "$status_file")
                local agents=$(jq -r '.agents' "$status_file")
                echo ""
                echo "ID: $swarm_id"
                echo "Project: $project"
                echo "Agents: $agents"
                echo "----------------------------------------"
            fi
        fi
    done
}

# Main command handler
case "${1:-}" in
    "start")
        check_prerequisites
        initialize_swarm
        shift
        launch_swarm "$@"
        ;;
    "parallel")
        check_prerequisites
        initialize_swarm
        launch_parallel_swarms
        ;;
    "monitor")
        if [ -n "${2:-}" ]; then
            monitor_swarm "$2"
        else
            monitor_all_swarms
        fi
        ;;
    "stop")
        if [ -z "${2:-}" ]; then
            print_error "Please provide swarm ID"
            exit 1
        fi
        stop_swarm "$2"
        ;;
    "cleanup")
        cleanup_swarms
        ;;
    "dashboard")
        show_dashboard
        ;;
    "help"|"--help"|"-h"|"")
        echo "Ralph Swarm Deployment Script"
        echo ""
        echo "Usage: $0 [command] [options]"
        echo ""
        echo "Commands:"
        echo "  start <project> [agents] [max]  Launch a swarm for a project"
        echo "  parallel                         Launch multiple parallel swarms"
        echo "  monitor [swarm_id]               Monitor swarm(s) status"
        echo "  stop <swarm_id>                  Stop a specific swarm"
        echo "  cleanup                          Clean up stopped swarms"
        echo "  dashboard                        Show swarm dashboard"
        echo "  help                             Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 start \"Build a todo app\" \"developer,tester\" 4"
        echo "  $0 parallel"
        echo "  $0 monitor swarm-20240120-123456-1234"
        echo "  $0 stop swarm-20240120-123456-1234"
        echo "  $0 dashboard"
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Run '$0 help' for usage information"
        exit 1
        ;;
esac