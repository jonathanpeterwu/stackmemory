#!/usr/bin/env node

/**
 * Real-time Swarm Monitoring Utility
 * Provides live monitoring and metrics for running swarms
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import blessed from 'blessed';

class SwarmMonitor {
  constructor() {
    this.swarmDir = '.swarm';
    this.statusDir = path.join(this.swarmDir, 'status');
    this.logsDir = path.join(this.swarmDir, 'logs');
    this.metricsHistory = [];
    this.maxHistorySize = 100;
    this.updateInterval = 2000; // 2 seconds
    this.wsPort = 3456;
  }

  async startMonitoring() {
    console.log('🔍 Starting Swarm Monitor...');
    
    // Check if we should use terminal UI or web interface
    const mode = process.argv[2] || 'terminal';
    
    if (mode === 'web') {
      await this.startWebMonitor();
    } else {
      await this.startTerminalMonitor();
    }
  }

  async startTerminalMonitor() {
    // Create blessed screen
    const screen = blessed.screen({
      smartCSR: true,
      title: 'Ralph Swarm Monitor'
    });

    // Create layout boxes
    const header = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' RALPH SWARM MONITOR ',
      align: 'center',
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      }
    });

    const swarmList = blessed.list({
      parent: screen,
      top: 3,
      left: 0,
      width: '50%',
      height: '40%',
      label: ' Active Swarms ',
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        border: {
          fg: 'cyan'
        },
        selected: {
          bg: 'blue'
        }
      },
      mouse: true,
      keys: true,
      vi: true
    });

    const metricsBox = blessed.box({
      parent: screen,
      top: 3,
      left: '50%',
      width: '50%',
      height: '40%',
      label: ' Performance Metrics ',
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        border: {
          fg: 'yellow'
        }
      }
    });

    const logBox = blessed.log({
      parent: screen,
      bottom: 3,
      left: 0,
      width: '100%',
      height: '55%',
      label: ' Live Logs ',
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        border: {
          fg: 'green'
        }
      },
      scrollable: true,
      alwaysScroll: true,
      mouse: true
    });

    const statusBar = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      style: {
        fg: 'white',
        bg: 'black'
      }
    });

    // Handle exit
    screen.key(['q', 'C-c'], () => {
      return process.exit(0);
    });

    // Update function
    const updateDisplay = async () => {
      try {
        // Get swarm status
        const swarms = await this.getActiveSwarms();
        
        // Update swarm list
        const swarmItems = swarms.map(s => {
          const status = s.status === 'running' ? '🟢' : '🔴';
          return `${status} ${s.id} - ${s.project}`;
        });
        swarmList.setItems(swarmItems);

        // Update metrics
        const metrics = await this.collectMetrics(swarms);
        const metricsContent = this.formatMetrics(metrics);
        metricsBox.setContent(metricsContent);

        // Update status bar
        const now = new Date().toLocaleTimeString();
        statusBar.setContent(
          ` Active: ${swarms.filter(s => s.status === 'running').length} | ` +
          `Total: ${swarms.length} | ` +
          `Updated: ${now} | ` +
          `Press 'q' to quit`
        );

        screen.render();
      } catch (error) {
        logBox.log(`Error: ${error.message}`);
      }
    };

    // Handle swarm selection
    swarmList.on('select', async (item, index) => {
      const swarms = await this.getActiveSwarms();
      if (swarms[index]) {
        await this.tailSwarmLogs(swarms[index], logBox);
      }
    });

    // Start update loop
    await updateDisplay();
    setInterval(updateDisplay, this.updateInterval);

    screen.render();
  }

  async startWebMonitor() {
    // Create HTTP server for web interface
    const server = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.getWebInterface());
      } else if (req.url === '/api/swarms') {
        this.handleApiRequest(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    // Create WebSocket server for real-time updates
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      console.log('Client connected to monitor');
      
      // Send initial data
      this.sendSwarmUpdate(ws);

      // Set up periodic updates
      const updateInterval = setInterval(() => {
        this.sendSwarmUpdate(ws);
      }, this.updateInterval);

      ws.on('close', () => {
        clearInterval(updateInterval);
        console.log('Client disconnected from monitor');
      });
    });

    server.listen(this.wsPort, () => {
      console.log(`📡 Web monitor running at http://localhost:${this.wsPort}`);
      console.log('Open in browser to view real-time swarm status');
    });
  }

  async getActiveSwarms() {
    const swarms = [];
    
    try {
      const files = await fs.readdir(this.statusDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.statusDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const swarm = JSON.parse(content);
          
          // Check if process is still running
          if (swarm.pid) {
            try {
              process.kill(swarm.pid, 0);
              swarm.status = 'running';
            } catch {
              swarm.status = 'stopped';
            }
          }
          
          swarms.push(swarm);
        }
      }
    } catch (error) {
      // Directory might not exist
    }
    
    return swarms;
  }

  async collectMetrics(swarms) {
    const metrics = {
      timestamp: Date.now(),
      activeSwarms: swarms.filter(s => s.status === 'running').length,
      totalSwarms: swarms.length,
      agentCount: 0,
      taskCompletion: 0,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };

    // Count total agents
    for (const swarm of swarms) {
      if (swarm.agents) {
        metrics.agentCount += swarm.agents.split(',').length;
      }
    }

    // Calculate average task completion (mock for now)
    metrics.taskCompletion = Math.round(Math.random() * 100);

    // Store in history
    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }

    return metrics;
  }

  formatMetrics(metrics) {
    const memoryMB = (metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
    
    return `
 Active Swarms: ${metrics.activeSwarms}/${metrics.totalSwarms}
 Total Agents: ${metrics.agentCount}
 Task Completion: ${metrics.taskCompletion}%
 
 Memory Usage: ${memoryMB} MB
 CPU Time: ${metrics.cpuUsage.user / 1000}ms
 
 Performance Trend:
 ${this.getPerformanceTrend()}
    `;
  }

  getPerformanceTrend() {
    if (this.metricsHistory.length < 2) return 'Collecting data...';
    
    const recent = this.metricsHistory.slice(-10);
    let trend = '';
    
    for (let i = 0; i < recent.length; i++) {
      const value = recent[i].taskCompletion;
      if (value > 80) trend += '█';
      else if (value > 60) trend += '▓';
      else if (value > 40) trend += '▒';
      else if (value > 20) trend += '░';
      else trend += ' ';
    }
    
    return trend;
  }

  async tailSwarmLogs(swarm, logBox) {
    const logFile = swarm.logFile || path.join(this.logsDir, `${swarm.id}.log`);
    
    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.split('\n');
      const recentLines = lines.slice(-20);
      
      logBox.log(`\n=== Logs for ${swarm.id} ===`);
      recentLines.forEach(line => {
        if (line.trim()) {
          logBox.log(line);
        }
      });
    } catch (error) {
      logBox.log(`Could not read logs for ${swarm.id}: ${error.message}`);
    }
  }

  async sendSwarmUpdate(ws) {
    try {
      const swarms = await this.getActiveSwarms();
      const metrics = await this.collectMetrics(swarms);
      
      ws.send(JSON.stringify({
        type: 'update',
        swarms,
        metrics,
        history: this.metricsHistory.slice(-20)
      }));
    } catch (error) {
      console.error('Failed to send update:', error);
    }
  }

  async handleApiRequest(res) {
    try {
      const swarms = await this.getActiveSwarms();
      const metrics = await this.collectMetrics(swarms);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ swarms, metrics }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  getWebInterface() {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Ralph Swarm Monitor</title>
  <style>
    body {
      font-family: 'Monaco', 'Menlo', monospace;
      background: #1e1e1e;
      color: #d4d4d4;
      margin: 0;
      padding: 20px;
    }
    h1 {
      color: #569cd6;
      text-align: center;
    }
    .container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 20px;
    }
    .panel {
      background: #2d2d30;
      border: 1px solid #3e3e42;
      border-radius: 5px;
      padding: 15px;
    }
    .panel h2 {
      color: #4ec9b0;
      margin-top: 0;
    }
    .swarm-item {
      padding: 8px;
      margin: 5px 0;
      background: #1e1e1e;
      border-radius: 3px;
    }
    .status-running {
      border-left: 3px solid #4ec9b0;
    }
    .status-stopped {
      border-left: 3px solid #f44747;
    }
    .metrics {
      font-size: 14px;
    }
    .metric-label {
      color: #9cdcfe;
    }
    .metric-value {
      color: #d4d4d4;
      font-weight: bold;
    }
    #logs {
      background: #1e1e1e;
      padding: 10px;
      height: 200px;
      overflow-y: auto;
      font-size: 12px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>🚀 Ralph Swarm Monitor</h1>
  
  <div class="container">
    <div class="panel">
      <h2>Active Swarms</h2>
      <div id="swarms"></div>
    </div>
    
    <div class="panel">
      <h2>Performance Metrics</h2>
      <div id="metrics" class="metrics"></div>
    </div>
  </div>
  
  <div class="panel" style="margin-top: 20px;">
    <h2>Live Logs</h2>
    <div id="logs"></div>
  </div>

  <script>
    const ws = new WebSocket('ws://localhost:${this.wsPort}');
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateDisplay(data);
    };
    
    function updateDisplay(data) {
      // Update swarms
      const swarmsDiv = document.getElementById('swarms');
      swarmsDiv.innerHTML = data.swarms.map(s => \`
        <div class="swarm-item status-\${s.status}">
          <strong>\${s.id}</strong><br>
          Project: \${s.project}<br>
          Agents: \${s.agents}<br>
          Status: \${s.status}
        </div>
      \`).join('');
      
      // Update metrics
      const metricsDiv = document.getElementById('metrics');
      metricsDiv.innerHTML = \`
        <p><span class="metric-label">Active Swarms:</span> <span class="metric-value">\${data.metrics.activeSwarms}/\${data.metrics.totalSwarms}</span></p>
        <p><span class="metric-label">Total Agents:</span> <span class="metric-value">\${data.metrics.agentCount}</span></p>
        <p><span class="metric-label">Task Completion:</span> <span class="metric-value">\${data.metrics.taskCompletion}%</span></p>
        <p><span class="metric-label">Memory Usage:</span> <span class="metric-value">\${(data.metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB</span></p>
      \`;
      
      // Update logs (mock for now)
      const logsDiv = document.getElementById('logs');
      if (Math.random() > 0.7) {
        const logEntry = new Date().toLocaleTimeString() + ' - Swarm activity detected\\n';
        logsDiv.textContent += logEntry;
        logsDiv.scrollTop = logsDiv.scrollHeight;
      }
    }
  </script>
</body>
</html>
    `;
  }
}

// Run monitor if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new SwarmMonitor();
  monitor.startMonitoring().catch(console.error);
}

export { SwarmMonitor };