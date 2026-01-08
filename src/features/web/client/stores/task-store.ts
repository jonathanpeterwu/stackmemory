import { create } from 'zustand'

export interface Task {
  id: string
  identifier: string
  title: string
  description?: string
  state: string
  priority?: number
  estimate?: number
  assignee?: string
  createdAt: string
  updatedAt: string
  lastSyncedAt?: string
  syncStatus?: string
}

interface TaskStore {
  tasks: Task[]
  setTasks: (tasks: Task[]) => void
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  getTaskById: (id: string) => Task | undefined
  getTasksByState: (state: string) => Task[]
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  
  setTasks: (tasks) => set({ tasks }),
  
  addTask: (task) => set((state) => ({
    tasks: [...state.tasks, task],
  })),
  
  updateTask: (id, updates) => set((state) => ({
    tasks: state.tasks.map((task: any) =>
      task.id === id ? { ...task, ...updates } : task
    ),
  })),
  
  removeTask: (id) => set((state) => ({
    tasks: state.tasks.filter((task: any) => task.id !== id),
  })),
  
  getTaskById: (id) => get().tasks.find((task: any) => task.id === id),
  
  getTasksByState: (state) => get().tasks.filter((task: any) => task.state === state),
}))