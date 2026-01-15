#!/usr/bin/env node
/**
 * Install StackMemory Linear Auto-Sync as a system service
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

function detectPlatform() {
  const platform = os.platform();
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  if (platform === 'win32') return 'windows';
  throw new Error(`Unsupported platform: ${platform}`);
}

function installMacOS() {
  const homeDir = os.homedir();
  const launchAgentDir = join(homeDir, 'Library', 'LaunchAgents');

  if (!existsSync(launchAgentDir)) {
    mkdirSync(launchAgentDir, { recursive: true });
  }

  const plistPath = join(launchAgentDir, 'ai.stackmemory.linear-sync.plist');
  const stackmemoryBin = join(projectRoot, 'dist', 'src', 'cli', 'cli.js');

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.stackmemory.linear-sync</string>
  
  <key>ProgramArguments</key>
  <array>
    <string>node</string>
    <string>${stackmemoryBin}</string>
    <string>linear</string>
    <string>auto-sync</string>
    <string>--start</string>
    <string>--interval</string>
    <string>5</string>
  </array>
  
  <key>WorkingDirectory</key>
  <string>${homeDir}</string>
  
  <key>StandardOutPath</key>
  <string>${homeDir}/.stackmemory/logs/linear-sync.log</string>
  
  <key>StandardErrorPath</key>
  <string>${homeDir}/.stackmemory/logs/linear-sync-error.log</string>
  
  <key>RunAtLoad</key>
  <true/>
  
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  
  <key>StartInterval</key>
  <integer>300</integer>
  
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(plistPath, plistContent);

  // Create log directory
  const logDir = join(homeDir, '.stackmemory', 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  try {
    execSync(`launchctl load ${plistPath}`);
    console.log('✅ macOS LaunchAgent installed and started');
    console.log(`📄 Configuration: ${plistPath}`);
    console.log(`📝 Logs: ${logDir}/linear-sync.log`);
    console.log('\n💡 Management commands:');
    console.log(`   Start:  launchctl load ${plistPath}`);
    console.log(`   Stop:   launchctl unload ${plistPath}`);
    console.log(`   Status: launchctl list | grep stackmemory`);
  } catch (error) {
    console.error('❌ Failed to load LaunchAgent:', error.message);
    console.log(`📄 Configuration saved to: ${plistPath}`);
    console.log('💡 To start manually: launchctl load ${plistPath}');
  }
}

function installLinux() {
  const serviceContent = `[Unit]
Description=StackMemory Linear Auto-Sync
After=network.target

[Service]
Type=simple
User=${os.userInfo().username}
WorkingDirectory=${os.homedir()}
ExecStart=node ${join(projectRoot, 'dist', 'src', 'cli', 'cli.js')} linear auto-sync --start --interval 5
Restart=always
RestartSec=10
StandardOutput=append:${os.homedir()}/.stackmemory/logs/linear-sync.log
StandardError=append:${os.homedir()}/.stackmemory/logs/linear-sync-error.log
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target`;

  const serviceDir = join(os.homedir(), '.config', 'systemd', 'user');
  if (!existsSync(serviceDir)) {
    mkdirSync(serviceDir, { recursive: true });
  }

  const servicePath = join(serviceDir, 'stackmemory-linear-sync.service');
  writeFileSync(servicePath, serviceContent);

  // Create log directory
  const logDir = join(os.homedir(), '.stackmemory', 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  try {
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable stackmemory-linear-sync.service');
    execSync('systemctl --user start stackmemory-linear-sync.service');

    console.log('✅ Linux systemd service installed and started');
    console.log(`📄 Configuration: ${servicePath}`);
    console.log(`📝 Logs: ${logDir}/linear-sync.log`);
    console.log('\n💡 Management commands:');
    console.log('   Start:  systemctl --user start stackmemory-linear-sync');
    console.log('   Stop:   systemctl --user stop stackmemory-linear-sync');
    console.log('   Status: systemctl --user status stackmemory-linear-sync');
    console.log('   Logs:   journalctl --user -u stackmemory-linear-sync -f');
  } catch (error) {
    console.error('❌ Failed to start systemd service:', error.message);
    console.log(`📄 Configuration saved to: ${servicePath}`);
    console.log('💡 To start manually:');
    console.log('   systemctl --user daemon-reload');
    console.log('   systemctl --user enable stackmemory-linear-sync');
    console.log('   systemctl --user start stackmemory-linear-sync');
  }
}

function installWindows() {
  const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2024-01-01T00:00:00</Date>
    <Author>StackMemory</Author>
    <Description>StackMemory Linear Auto-Sync Service</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>1999-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions>
    <Exec>
      <Command>node</Command>
      <Arguments>"${join(projectRoot, 'dist', 'src', 'cli', 'cli.js').replace(/\\/g, '\\\\')}" linear auto-sync --start --interval 5</Arguments>
      <WorkingDirectory>${os.homedir().replace(/\\/g, '\\\\')}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;

  const taskFile = join(os.tmpdir(), 'stackmemory-linear-sync.xml');
  writeFileSync(taskFile, taskXml);

  try {
    execSync(
      `schtasks /create /tn "StackMemory Linear Sync" /xml "${taskFile}"`
    );
    console.log('✅ Windows Task Scheduler task created');
    console.log('\n💡 Management commands:');
    console.log('   Start:  schtasks /run /tn "StackMemory Linear Sync"');
    console.log('   Stop:   schtasks /end /tn "StackMemory Linear Sync"');
    console.log('   Status: schtasks /query /tn "StackMemory Linear Sync"');
    console.log('   Delete: schtasks /delete /tn "StackMemory Linear Sync"');
  } catch (error) {
    console.error('❌ Failed to create scheduled task:', error.message);
    console.log(`📄 Task XML saved to: ${taskFile}`);
    console.log('💡 Import manually through Task Scheduler');
  }
}

function main() {
  console.log('🔧 Installing StackMemory Linear Auto-Sync Service\n');

  const platform = detectPlatform();
  console.log(`🖥️  Detected platform: ${platform}`);

  // Check if StackMemory is built
  const builtCli = join(projectRoot, 'dist', 'src', 'cli', 'cli.js');
  if (!existsSync(builtCli)) {
    console.error('❌ StackMemory not built. Run "npm run build" first.');
    process.exit(1);
  }

  switch (platform) {
    case 'macos':
      installMacOS();
      break;
    case 'linux':
      installLinux();
      break;
    case 'windows':
      installWindows();
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  console.log('\n🎉 Installation complete!');
  console.log('\n📋 Next steps:');
  console.log('1. Configure Linear integration: stackmemory linear setup');
  console.log('2. Authorize with Linear: stackmemory linear authorize <code>');
  console.log('3. Check service status with platform commands above');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
