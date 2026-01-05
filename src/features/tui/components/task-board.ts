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

    // Quick actions
    container.key(['enter'], () => {
      if (this.selectedTask) {
        this.showTaskDetails(this.tasks.get(this.selectedTask)!);
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

    let taskStr = `${priority} ${task.identifier}: ${task.title}\n`;
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
}
