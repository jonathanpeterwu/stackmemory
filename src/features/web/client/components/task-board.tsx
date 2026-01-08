'use client'

import { useTaskStore } from '@/stores/task-store'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

export function TaskBoard() {
  const tasks = useTaskStore((state) => state.tasks)

  // Group tasks by state
  const tasksByState = tasks.reduce((acc, task) => {
    const state = task.state || 'Backlog'
    if (!acc[state]) acc[state] = []
    acc[state].push(task)
    return acc
  }, {} as Record<string, typeof tasks>)

  const states = ['In Progress', 'In Review', 'Todo', 'Backlog', 'Done']
  const stateColors = {
    'In Progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'In Review': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    'Todo': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'Backlog': 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    'Done': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-4">
        {states.map((state: any) => {
          const stateTasks = tasksByState[state] || []
          if (stateTasks.length === 0) return null

          return (
            <div key={state} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{state}</h3>
                <Badge variant="secondary" className="text-xs">
                  {stateTasks.length}
                </Badge>
              </div>
              <div className="space-y-1">
                {stateTasks.slice(0, 5).map((task: any) => (
                  <div
                    key={task.id}
                    className="p-2 border rounded-lg hover:bg-accent transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {task.identifier}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${stateColors[state] || ''}`}
                          >
                            {state}
                          </Badge>
                        </div>
                        <p className="text-sm truncate mt-1">{task.title}</p>
                      </div>
                      {task.priority && (
                        <PriorityIndicator priority={task.priority} />
                      )}
                    </div>
                  </div>
                ))}
                {stateTasks.length > 5 && (
                  <p className="text-xs text-muted-foreground pl-2">
                    +{stateTasks.length - 5} more
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function PriorityIndicator({ priority }: { priority: number }) {
  const colors = {
    1: 'text-red-600',
    2: 'text-orange-600',
    3: 'text-yellow-600',
    4: 'text-blue-600',
  }
  
  const labels = {
    1: 'Urgent',
    2: 'High',
    3: 'Medium',
    4: 'Low',
  }
  
  return (
    <span className={`text-xs font-medium ${colors[priority as keyof typeof colors] || 'text-gray-600'}`}>
      {labels[priority as keyof typeof labels] || 'Low'}
    </span>
  )
}