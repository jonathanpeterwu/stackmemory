/**
 * Task Board Component
 * Displays Linear tasks with live synchronization
 */

import blessed from 'blessed';
import { EventEmitter } from 'events';
import type { LinearTask, TaskColumn } from '../types.js';

export class TaskBoard extends EventEmitter {
  private container: blessed.Widgets.BoxElement;
  private columns: Map<string, blessed.Widgets.ListElement>;
  private tasks: Map<string, LinearTask>;
  private selectedTask: string | null = null;
  private currentColumn: string = 'todo';

  private readonly columnConfig: TaskColumn[] = [
    { id: 'backlog', title: 'Backlog', color: 'gray' },
    { id: 'todo', title: 'To Do', color: 'cyan' },
    { id: 'in_progress', title: 'In Progress', color: 'yellow' },
    { id: 'review', title: 'Review', color: 'magenta' },
    { id: 'done', title: 'Done', color: 'green' },
  ];

  constructor(container: blessed.Widgets.BoxElement) {
    super();
    this.container = container;
    this.columns = new Map();
    this.tasks = new Map();
    this.initializeUI();
  }

  private initializeUI(): void {
    const columnWidth = Math.floor(100 / this.columnConfig.length);

    this.columnConfig.forEach((column, index) => {
      // Column container
      const columnBox = blessed.box({
        parent: this.container,
        left: `${index * columnWidth}%`,
        top: 0,
        width: `${columnWidth}%`,
        height: '100%',
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: column.color,
          },
        },
        label: ` ${column.title} `,
      });

      // Task list within column
      const taskList = blessed.list({
        parent: columnBox,
        top: 0,
        left: 0,
        width: '100%-2',
        height: '100%-2',
        style: {
          selected: {
            bg: column.color,
            fg: 'black',
            bold: true,
          },
          item: {
            fg: 'white',
          },
        },
        mouse: true,
        keys: true,
        vi: true,
        scrollable: true,
        tags: true,
      });

      taskList.on('select', (item, index) => {
        const tasksInColumn = this.getTasksInColumn(column.id);
        if (tasksInColumn[index]) {
          this.selectTask(tasksInColumn[index].id);
        }
      });

      this.columns.set(column.id, taskList);
    });

    // Set up keyboard navigation
    this.setupKeyboardNavigation();
  }

  private setupKeyboardNavigation(): void {
    const container = this.container;

    // Navigate between columns
    container.key(['left', 'h'], () => {
      this.navigateColumn(-1);
    });

    container.key(['right', 'l'], () => {
      this.navigateColumn(1);
    });

    // Move tasks between columns
    container.key(['S-left'], () => {
      this.moveTaskToColumn(-1);
    });

    container.key(['S-right'], () => {
      this.moveTaskToColumn(1);
    });

    // Quick actions - Enter opens task completion menu
    container.key(['enter'], () => {
      if (this.selectedTask) {
        this.showTaskCompletionMenu(this.tasks.get(this.selectedTask)!);
      }
    });

    container.key(['n'], () => {
      this.createNewTask();
    });

    container.key(['d'], () => {
      if (this.selectedTask) {
        this.markTaskDone(this.selectedTask);
      }
    });

    container.key(['a'], () => {
      if (this.selectedTask) {
        this.assignTask(this.selectedTask);
      }
    });

    // Update task status (u key)
    container.key(['u'], () => {
      if (this.selectedTask) {
        this.showStatusUpdateDialog(this.selectedTask);
      }
    });

    // Start working on task with Claude (c key)
    container.key(['c'], () => {
      if (this.selectedTask) {
        this.startTaskWithClaude(this.selectedTask);
      }
    });

    // Sync with Linear (s key)
    container.key(['s'], () => {
      this.syncWithLinear();
    });
  }

  private getTasksInColumn(columnId: string): LinearTask[] {
    return Array.from(this.tasks.values())
      .filter((task) => this.getTaskColumn(task) === columnId)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  private getTaskColumn(task: LinearTask): string {
    // Map Linear states to our columns - handle both raw API states and formatted display states
    const stateMapping: Record<string, string> = {
      // Raw Linear API states
      backlog: 'backlog',
      unstarted: 'todo',
      started: 'in_progress',
      completed: 'done',
      canceled: 'done',
      cancelled: 'done',
      // Formatted display states from data service
      Backlog: 'backlog',
      'To Do': 'todo',
      'In Progress': 'in_progress',
      Done: 'done',
      Canceled: 'done',
      // Legacy mappings
      todo: 'todo',
      in_progress: 'in_progress',
      in_review: 'review',
      done: 'done',
    };

    const state = task.state || 'todo';
    return stateMapping[state] || stateMapping[state.toLowerCase()] || 'todo';
  }

  private formatTaskItem(task: LinearTask): string {
    const priority = this.getPriorityIcon(task.priority);
    const estimate = task.estimate ? `[${task.estimate}]` : '';

    // Handle both object and string assignee formats
    let assignee: string;
    if (typeof task.assignee === 'string') {
      assignee = `@${task.assignee}`;
    } else if (task.assignee?.name) {
      assignee = `@${task.assignee.name}`;
    } else {
      assignee = '{gray-fg}unassigned{/}';
    }

    const labels = task.labels?.map((l) => `{cyan-fg}#${l}{/}`).join(' ') || '';

    // Show task identifier (STA-100) prominently with description preview
    let taskStr = `${priority} {bold}${task.identifier}{/}: ${task.title}\n`;

    // Add description preview if available (first line or 60 chars)
    if (task.description && task.description.trim()) {
      const descPreview = task.description
        .split('\n')[0]
        .substring(0, 60)
        .trim();
      taskStr += `  {gray-fg}${descPreview}${task.description.length > 60 ? '...' : ''}{/}\n`;
    }

    taskStr += `  {gray-fg}${assignee} ${estimate} ${labels}{/}`;

    // Add progress indicators
    if (task.progress !== undefined) {
      const progressBar = this.createProgressBar(task.progress);
      taskStr += `\n  ${progressBar}`;
    }

    // Add due date warning
    if (task.dueDate) {
      const daysUntilDue = this.getDaysUntilDue(task.dueDate);
      if (daysUntilDue < 0) {
        taskStr += ` {red-fg}⚠ Overdue{/}`;
      } else if (daysUntilDue <= 1) {
        taskStr += ` {yellow-fg}⚠ Due soon{/}`;
      }
    }

    return taskStr;
  }

  private getPriorityIcon(priority?: number): string {
    if (!priority) return '○';
    switch (priority) {
      case 0:
        return '{red-fg}🔴{/}'; // Urgent
      case 1:
        return '{yellow-fg}🟡{/}'; // High
      case 2:
        return '{green-fg}🟢{/}'; // Medium
      case 3:
        return '{blue-fg}🔵{/}'; // Low
      default:
        return '○';
    }
  }

  private createProgressBar(progress: number): string {
    const width = 10;
    const filled = Math.round(progress * width);
    const empty = width - filled;

    const color = progress >= 1 ? 'green' : progress >= 0.5 ? 'yellow' : 'red';
    return `{${color}-fg}${'█'.repeat(filled)}{/}{gray-fg}${'░'.repeat(empty)}{/} ${Math.round(progress * 100)}%`;
  }

  private getDaysUntilDue(dueDate: string): number {
    const due = new Date(dueDate);
    const now = new Date();
    const diffTime = due.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  public update(tasks: LinearTask[]): void {
    // Update task map
    this.tasks.clear();
    tasks.forEach((task) => {
      this.tasks.set(task.id, task);
    });

    // Update each column
    this.columnConfig.forEach((column) => {
      const columnTasks = this.getTasksInColumn(column.id);
      const items = columnTasks.map((task) => this.formatTaskItem(task));

      const list = this.columns.get(column.id);
      if (list) {
        list.setItems(items);

        // Update column label with count
        const parent = list.parent;
        if (parent && typeof (parent as any).setLabel === 'function') {
          (parent as any).setLabel(` ${column.title} (${columnTasks.length}) `);
        }
      }
    });

    this.container.screen.render();
  }

  private navigateColumn(direction: number): void {
    const columnIds = this.columnConfig.map((c) => c.id);
    const currentIndex = columnIds.indexOf(this.currentColumn);
    const newIndex = Math.max(
      0,
      Math.min(columnIds.length - 1, currentIndex + direction)
    );

    this.currentColumn = columnIds[newIndex];
    this.columns.get(this.currentColumn)?.focus();
    this.container.screen.render();
  }

  private moveTaskToColumn(direction: number): void {
    if (!this.selectedTask) return;

    const task = this.tasks.get(this.selectedTask);
    if (!task) return;

    const columnIds = this.columnConfig.map((c) => c.id);
    const currentColumnIndex = columnIds.indexOf(this.getTaskColumn(task));
    const newColumnIndex = Math.max(
      0,
      Math.min(columnIds.length - 1, currentColumnIndex + direction)
    );
    const newColumn = columnIds[newColumnIndex];

    // Emit event to update task state in Linear
    this.emit('task:move', {
      taskId: task.id,
      fromColumn: columnIds[currentColumnIndex],
      toColumn: newColumn,
    });

    // Optimistically update UI
    const stateMapping: Record<string, string> = {
      backlog: 'backlog',
      todo: 'unstarted',
      in_progress: 'started',
      review: 'in_review',
      done: 'completed',
    };

    task.state = stateMapping[newColumn] || task.state;
    this.update(Array.from(this.tasks.values()));
  }

  private selectTask(taskId: string): void {
    this.selectedTask = taskId;
    const task = this.tasks.get(taskId);
    if (task) {
      this.emit('task:selected', task);
    }
  }

  private showTaskDetails(task: LinearTask): void {
    const details = blessed.box({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '70%',
      content: this.formatTaskDetails(task),
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      hidden: false,
      label: ` Task: ${task.identifier} - ${task.title} `,
    });

    details.key(['escape', 'q'], () => {
      details.destroy();
      this.container.screen.render();
    });

    details.focus();
    this.container.screen.render();
  }

  private formatTaskDetails(task: LinearTask): string {
    let details = `{bold}ID:{/} ${task.identifier}\n`;
    details += `{bold}Title:{/} ${task.title}\n`;
    details += `{bold}State:{/} ${task.state}\n`;
    details += `{bold}Priority:{/} ${this.getPriorityIcon(task.priority)} ${task.priority || 'None'}\n`;

    if (task.assignee) {
      if (typeof task.assignee === 'string') {
        details += `{bold}Assignee:{/} ${task.assignee}\n`;
      } else {
        details += `{bold}Assignee:{/} ${task.assignee.name} (${task.assignee.email})\n`;
      }
    }

    if (task.estimate) {
      details += `{bold}Estimate:{/} ${task.estimate} points\n`;
    }

    if (task.dueDate) {
      const daysUntil = this.getDaysUntilDue(task.dueDate);
      const dueColor =
        daysUntil < 0 ? 'red' : daysUntil <= 1 ? 'yellow' : 'white';
      details += `{bold}Due Date:{/} {${dueColor}-fg}${new Date(task.dueDate).toLocaleDateString()}{/}\n`;
    }

    if (task.labels && task.labels.length > 0) {
      details += `{bold}Labels:{/} ${task.labels.map((l) => `{cyan-fg}#${l}{/}`).join(' ')}\n`;
    }

    if (task.description) {
      details += `\n{bold}Description:{/}\n${task.description}\n`;
    }

    if (task.comments && task.comments.length > 0) {
      details += `\n{bold}Comments ({${task.comments.length}}):{/}\n`;
      task.comments.slice(-5).forEach((comment) => {
        details += `\n{gray-fg}${comment.author} - ${new Date(comment.createdAt).toLocaleString()}{/}\n`;
        details += `${comment.body}\n`;
      });
    }

    if (task.subtasks && task.subtasks.length > 0) {
      details += `\n{bold}Subtasks:{/}\n`;
      task.subtasks.forEach((subtask) => {
        const check = subtask.completed ? '✓' : '○';
        details += `  ${check} ${subtask.title}\n`;
      });
    }

    details += `\n{bold}Actions:{/}\n`;
    details += `  [d] Mark Done | [a] Assign | [c] Comment | [e] Edit\n`;

    return details;
  }

  private createNewTask(): void {
    const form = blessed.form({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 14,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
      label: ' Create New Task ',
      keys: true,
    });

    const titleLabel = blessed.text({
      parent: form,
      content: 'Title:',
      top: 1,
      left: 2,
    });

    const titleInput = blessed.textbox({
      parent: form,
      name: 'title',
      top: 1,
      left: 10,
      width: '100%-12',
      height: 1,
      inputOnFocus: true,
      style: {
        focus: {
          fg: 'white',
          bg: 'blue',
        },
      },
    });

    const descLabel = blessed.text({
      parent: form,
      content: 'Desc:',
      top: 3,
      left: 2,
    });

    const descInput = blessed.textarea({
      parent: form,
      name: 'description',
      top: 3,
      left: 10,
      width: '100%-12',
      height: 4,
      inputOnFocus: true,
      style: {
        focus: {
          fg: 'white',
          bg: 'blue',
        },
      },
    });

    const submitBtn = blessed.button({
      parent: form,
      content: ' Create ',
      top: 9,
      left: 'center',
      shrink: true,
      style: {
        focus: {
          bg: 'green',
          fg: 'white',
        },
      },
    });

    submitBtn.on('press', () => {
      const title = titleInput.getValue();
      const description = descInput.getValue();

      if (title) {
        this.emit('task:create', { title, description });
      }

      form.destroy();
      this.container.screen.render();
    });

    form.key(['escape'], () => {
      form.destroy();
      this.container.screen.render();
    });

    titleInput.focus();
    this.container.screen.render();
  }

  private markTaskDone(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.emit('task:update', {
        taskId: task.id,
        updates: { state: 'completed' },
      });

      // Optimistically update UI
      task.state = 'completed';
      this.update(Array.from(this.tasks.values()));
    }
  }

  private assignTask(taskId: string): void {
    // Would open assignment dialog
    this.emit('task:assign', { taskId });
  }

  public focus(): void {
    const column = this.columns.get(this.currentColumn);
    if (column) {
      column.focus();
    }
  }

  public hasFocus(): boolean {
    return Array.from(this.columns.values()).some(
      (col) => col === this.container.screen.focused
    );
  }

  private showStatusUpdateDialog(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Create status selection dialog
    const dialog = blessed.list({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 12,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
      label: ` Update Status: ${task.title.substring(0, 40)}... `,
      items: [
        '1. Backlog',
        '2. Todo',
        '3. In Progress',
        '4. In Review',
        '5. Done',
        '6. Canceled',
        '',
        'ESC to cancel',
      ],
      keys: true,
      vi: true,
      mouse: true,
    });

    dialog.on('select', (item: any, index: number) => {
      const statusMap = [
        'backlog',
        'todo',
        'in_progress',
        'review',
        'completed',
        'cancelled',
      ];
      if (index < statusMap.length) {
        this.updateTaskStatus(taskId, statusMap[index]);
      }
      dialog.destroy();
      this.container.screen.render();
    });

    dialog.key(['escape'], () => {
      dialog.destroy();
      this.container.screen.render();
    });

    dialog.focus();
    this.container.screen.render();
  }

  private async updateTaskStatus(
    taskId: string,
    newStatus: string
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Update local state immediately for responsiveness
    task.state = this.mapStatusToLinearState(newStatus);
    this.update(Array.from(this.tasks.values()));

    // Emit event for status update
    this.emit('task:status:update', {
      taskId,
      oldStatus: task.state,
      newStatus,
      linearId: task.identifier,
    });

    // Show notification
    const notification = blessed.message({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 3,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
      content: `Task status updated to: ${newStatus}`,
    });

    setTimeout(() => {
      notification.destroy();
      this.container.screen.render();
    }, 1500);

    this.container.screen.render();
  }

  private async startTaskWithClaude(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    try {
      const { exec } = await import('child_process');
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');

      // Create a context file with task details
      const contextDir = path.join(
        os.homedir(),
        '.stackmemory',
        'task-contexts'
      );
      await fs.mkdir(contextDir, { recursive: true });
      const contextFile = path.join(
        contextDir,
        `${task.identifier}-context.md`
      );
      const contextContent = `# Task: ${task.identifier} - ${task.title}

## Description
${task.description || 'No description provided'}

## Status
Current: ${task.state}
Priority: ${this.getPriorityLabel(task.priority)}

## Linear Task ID
${task.identifier}

## Quick Commands
- Update status: stackmemory task:update "${task.identifier}" --status <status>
- Add comment: stackmemory task:comment "${task.identifier}" --message "<comment>"
- View details: stackmemory task:show "${task.identifier}"

---
This task has been loaded from Linear. The context above provides the task details.
Start working on this task below:
`;

      await fs.writeFile(contextFile, contextContent);

      // Build the claude-sm command
      const command = `claude-sm --task "${task.identifier}: ${task.title}" --context "${contextFile}"`;

      // Show launching notification
      const notification = blessed.message({
        parent: this.container.screen,
        top: 'center',
        left: 'center',
        width: '60%',
        height: 5,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'cyan',
          },
        },
        content: `Launching Claude for task:\n${task.identifier}: ${task.title}\n\nCommand: ${command}`,
      });

      this.container.screen.render();

      // Execute in background
      exec(command, (error, stdout, stderr) => {
        if (error) {
          const errorMsg = blessed.message({
            parent: this.container.screen,
            top: 'center',
            left: 'center',
            width: '50%',
            height: 4,
            border: {
              type: 'line',
            },
            style: {
              border: {
                fg: 'red',
              },
            },
            content: `Failed to launch Claude: ${error.message}`,
          });

          setTimeout(() => {
            errorMsg.destroy();
            this.container.screen.render();
          }, 3000);
        }
      });

      setTimeout(() => {
        notification.destroy();
        this.container.screen.render();
      }, 2000);

      // Emit event for tracking
      this.emit('task:launch:claude', {
        taskId,
        command,
        task,
        contextFile,
      });
    } catch (error: any) {
      const errorMsg = blessed.message({
        parent: this.container.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 4,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'red',
          },
        },
        content: `Error: ${error.message}`,
      });

      setTimeout(() => {
        errorMsg.destroy();
        this.container.screen.render();
      }, 3000);

      this.container.screen.render();
    }
  }

  private showTaskCompletionMenu(task: LinearTask): void {
    // Create completion menu with task details and actions
    const menuBox = blessed.box({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '80%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
      label: ` Task Completion Menu: ${task.identifier} `,
      keys: true,
      mouse: true,
    });

    // Task header with ID and description
    const header = blessed.text({
      parent: menuBox,
      top: 1,
      left: 2,
      width: '100%-4',
      height: 5,
      content:
        `{bold}${task.identifier}: ${task.title}{/}\n\n` +
        `{gray-fg}${(task.description || 'No description').substring(0, 200)}{/}`,
      tags: true,
      wrap: true,
    });

    // Current status display
    const statusDisplay = blessed.text({
      parent: menuBox,
      top: 7,
      left: 2,
      content: `{bold}Current Status:{/} ${this.formatStatus(task.state)}`,
      tags: true,
    });

    // Menu options
    const menu = blessed.list({
      parent: menuBox,
      top: 9,
      left: 2,
      width: '100%-4',
      height: 12,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'gray',
        },
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
      label: ' Quick Actions ',
      items: [
        '1. ✅ Mark as Done',
        '2. 🔄 Change Status',
        '3. 🎯 Update Priority',
        '4. 👤 Assign to Someone',
        '5. 💬 Add Comment',
        '6. 📝 Edit Description',
        '7. 🚀 Start with Claude',
        '8. 🔍 View Full Details',
        '9. ❌ Cancel Task',
      ],
      keys: true,
      vi: true,
      mouse: true,
    });

    // Task metadata
    const metadata = blessed.text({
      parent: menuBox,
      bottom: 3,
      left: 2,
      width: '100%-4',
      height: 4,
      content: this.formatTaskMetadata(task),
      tags: true,
    });

    // Instructions
    const instructions = blessed.text({
      parent: menuBox,
      bottom: 1,
      left: 2,
      content:
        '{gray-fg}Use arrows/numbers to select • Enter to execute • ESC to close{/}',
      tags: true,
    });

    // Handle menu selection
    menu.on('select', (item, index) => {
      menuBox.destroy();

      switch (index) {
        case 0: // Mark as Done
          this.updateTaskStatus(task.id, 'completed');
          this.showNotification(`✅ Task ${task.identifier} marked as done`);
          break;
        case 1: // Change Status
          this.showStatusUpdateDialog(task.id);
          break;
        case 2: // Update Priority
          this.showPriorityUpdateDialog(task);
          break;
        case 3: // Assign
          this.showAssignDialog(task);
          break;
        case 4: // Add Comment
          this.showCommentDialog(task);
          break;
        case 5: // Edit Description
          this.showEditDescriptionDialog(task);
          break;
        case 6: // Start with Claude
          this.startTaskWithClaude(task.id);
          break;
        case 7: // View Full Details
          this.showTaskDetails(task);
          break;
        case 8: // Cancel Task
          this.updateTaskStatus(task.id, 'canceled');
          this.showNotification(`❌ Task ${task.identifier} canceled`);
          break;
      }

      this.container.screen.render();
    });

    // Handle number keys for quick selection
    menu.key(['1', '2', '3', '4', '5', '6', '7', '8', '9'], (ch) => {
      const index = parseInt(ch, 10) - 1;
      if (index < menu.items.length) {
        menu.select(index);
        menu.emit('select', menu.items[index], index);
      }
    });

    // ESC to close
    menuBox.key(['escape', 'q'], () => {
      menuBox.destroy();
      this.container.screen.render();
    });

    menu.focus();
    this.container.screen.render();
  }

  private formatStatus(state: string): string {
    const statusColors: Record<string, string> = {
      backlog: '{gray-fg}📋 Backlog{/}',
      unstarted: '{yellow-fg}⏸️ Todo{/}',
      started: '{blue-fg}▶️ In Progress{/}',
      completed: '{green-fg}✅ Done{/}',
      canceled: '{red-fg}❌ Canceled{/}',
    };
    return statusColors[state.toLowerCase()] || state;
  }

  private formatTaskMetadata(task: LinearTask): string {
    let meta = '';

    if (task.assignee) {
      const name =
        typeof task.assignee === 'string' ? task.assignee : task.assignee.name;
      meta += `{bold}Assignee:{/} ${name}  `;
    }

    if (task.priority !== undefined) {
      meta += `{bold}Priority:{/} ${this.getPriorityLabel(task.priority)}  `;
    }

    if (task.estimate) {
      meta += `{bold}Points:{/} ${task.estimate}  `;
    }

    if (task.dueDate) {
      const daysUntil = this.getDaysUntilDue(task.dueDate);
      const color = daysUntil < 0 ? 'red' : daysUntil <= 1 ? 'yellow' : 'white';
      meta += `{bold}Due:{/} {${color}-fg}${new Date(task.dueDate).toLocaleDateString()}{/}`;
    }

    return meta;
  }

  private getPriorityLabel(priority?: number): string {
    if (priority === undefined || priority === null) return 'None';
    const labels = ['Urgent', 'High', 'Medium', 'Low', 'None'];
    return labels[priority] || 'None';
  }

  private showPriorityUpdateDialog(task: LinearTask): void {
    const dialog = blessed.list({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '40%',
      height: 9,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'magenta',
        },
        selected: {
          bg: 'magenta',
          fg: 'white',
        },
      },
      label: ` Set Priority: ${task.identifier} `,
      items: [
        '🔴 Urgent (P0)',
        '🟡 High (P1)',
        '🟢 Medium (P2)',
        '🔵 Low (P3)',
        '⚪ None',
      ],
      keys: true,
      vi: true,
    });

    dialog.on('select', (item, index) => {
      const priority = index < 4 ? index : undefined;
      this.emit('task:update', {
        taskId: task.id,
        updates: { priority },
      });
      dialog.destroy();
      this.showNotification(`🎯 Priority updated for ${task.identifier}`);
      this.container.screen.render();
    });

    dialog.key(['escape'], () => {
      dialog.destroy();
      this.container.screen.render();
    });

    dialog.focus();
    this.container.screen.render();
  }

  private showAssignDialog(task: LinearTask): void {
    // Placeholder for assignment dialog
    this.showNotification('Assignment dialog coming soon!');
  }

  private showCommentDialog(task: LinearTask): void {
    const form = blessed.form({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 10,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
      label: ` Add Comment to ${task.identifier} `,
      keys: true,
    });

    const commentInput = blessed.textarea({
      parent: form,
      top: 1,
      left: 1,
      width: '100%-2',
      height: 5,
      inputOnFocus: true,
      style: {
        focus: {
          fg: 'white',
          bg: 'blue',
        },
      },
    });

    const submitBtn = blessed.button({
      parent: form,
      content: ' Add Comment ',
      bottom: 1,
      left: 'center',
      shrink: true,
      style: {
        focus: {
          bg: 'green',
          fg: 'white',
        },
      },
    });

    submitBtn.on('press', () => {
      const comment = commentInput.getValue();
      if (comment) {
        this.emit('task:comment', { taskId: task.id, comment });
        this.showNotification(`💬 Comment added to ${task.identifier}`);
      }
      form.destroy();
      this.container.screen.render();
    });

    form.key(['escape'], () => {
      form.destroy();
      this.container.screen.render();
    });

    commentInput.focus();
    this.container.screen.render();
  }

  private showEditDescriptionDialog(task: LinearTask): void {
    const form = blessed.form({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 15,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
      label: ` Edit Description: ${task.identifier} `,
      keys: true,
    });

    const descInput = blessed.textarea({
      parent: form,
      top: 1,
      left: 1,
      width: '100%-2',
      height: 10,
      inputOnFocus: true,
      content: task.description || '',
      style: {
        focus: {
          fg: 'white',
          bg: 'blue',
        },
      },
    });

    const submitBtn = blessed.button({
      parent: form,
      content: ' Save Description ',
      bottom: 1,
      left: 'center',
      shrink: true,
      style: {
        focus: {
          bg: 'cyan',
          fg: 'white',
        },
      },
    });

    submitBtn.on('press', () => {
      const description = descInput.getValue();
      this.emit('task:update', {
        taskId: task.id,
        updates: { description },
      });
      this.showNotification(`📝 Description updated for ${task.identifier}`);
      form.destroy();
      this.container.screen.render();
    });

    form.key(['escape'], () => {
      form.destroy();
      this.container.screen.render();
    });

    descInput.focus();
    this.container.screen.render();
  }

  private showNotification(message: string): void {
    const notification = blessed.box({
      parent: this.container.screen,
      top: 1,
      right: 1,
      width: message.length + 4,
      height: 3,
      content: ` ${message} `,
      style: {
        fg: 'white',
        bg: 'blue',
      },
      border: {
        type: 'line',
        fg: 'cyan',
      },
    });

    this.container.screen.render();

    // Auto-hide after 3 seconds
    setTimeout(() => {
      notification.destroy();
      this.container.screen.render();
    }, 3000);
  }

  private async syncWithLinear(): Promise<void> {
    try {
      // Show syncing notification
      const notification = blessed.box({
        parent: this.container.screen,
        top: 'center',
        left: 'center',
        width: '40%',
        height: 5,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'cyan',
          },
        },
        content: '{center}Syncing with Linear...{/center}',
        tags: true,
      });

      this.container.screen.render();

      const { exec } = await import('child_process');
      const util = await import('util');
      const execAsync = util.promisify(exec);

      // Run the sync command
      await execAsync('cd /Users/jwu/Dev/stackmemory && npm run linear:sync');

      // Update notification
      notification.setContent(
        '{center}✓ Sync complete! Refreshing...{/center}'
      );
      notification.style.border.fg = 'green';

      setTimeout(() => {
        notification.destroy();
        // Trigger refresh of tasks
        this.emit('tasks:refresh');
        this.container.screen.render();
      }, 1000);
    } catch (error: any) {
      const errorMsg = blessed.message({
        parent: this.container.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 4,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'red',
          },
        },
        content: `Sync failed: ${error.message}`,
      });

      setTimeout(() => {
        errorMsg.destroy();
        this.container.screen.render();
      }, 3000);

      this.container.screen.render();
    }
  }

  private mapStatusToLinearState(status: string): string {
    const mapping: Record<string, string> = {
      backlog: 'Backlog',
      todo: 'Todo',
      in_progress: 'In Progress',
      review: 'In Review',
      completed: 'Done',
      cancelled: 'Canceled',
    };
    return mapping[status] || 'Backlog';
  }
}
