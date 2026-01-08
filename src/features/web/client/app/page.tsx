'use client'

import { useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TaskBoard } from '@/components/task-board'
import { SessionMonitor } from '@/components/session-monitor'
import { FrameVisualizer } from '@/components/frame-visualizer'
import { AnalyticsChart } from '@/components/analytics-chart'
import { useSocket } from '@/hooks/use-socket'
import { useTaskStore } from '@/stores/task-store'
import { useSessionStore } from '@/stores/session-store'

export default function DashboardPage() {
  const socket = useSocket()
  const { tasks, setTasks } = useTaskStore()
  const { sessions, setSessions } = useSessionStore()

  useEffect(() => {
    if (socket) {
      socket.on('initial-data', (data) => {
        setTasks(data.tasks || [])
        setSessions(data.sessions || [])
      })

      socket.on('tasks:update', (tasks) => {
        setTasks(tasks)
      })

      socket.on('sessions:update', (sessions) => {
        setSessions(sessions)
      })

      return () => {
        socket.off('initial-data')
        socket.off('tasks:update')
        socket.off('sessions:update')
      }
    }
  }, [socket, setTasks, setSessions])

  const activeTasks = tasks.filter((t: any) => t.state === 'In Progress').length
  const completedTasks = tasks.filter((t: any) => t.state === 'Done').length
  const totalTasks = tasks.length

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">StackMemory Dashboard</h1>
        <p className="text-muted-foreground">Real-time monitoring and task management</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTasks}</div>
            <p className="text-xs text-muted-foreground">From Linear sync</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{activeTasks}</div>
            <p className="text-xs text-muted-foreground">In progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{completedTasks}</div>
            <p className="text-xs text-muted-foreground">Done</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{sessions.length}</div>
            <p className="text-xs text-muted-foreground">Live now</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task Board */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Task Board</CardTitle>
            <CardDescription>Linear synced tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <TaskBoard />
          </CardContent>
        </Card>

        {/* Session Monitor */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Active Sessions</CardTitle>
            <CardDescription>Live session tracking</CardDescription>
          </CardHeader>
          <CardContent>
            <SessionMonitor />
          </CardContent>
        </Card>

        {/* Analytics */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle>Analytics</CardTitle>
            <CardDescription>Task distribution and trends</CardDescription>
          </CardHeader>
          <CardContent>
            <AnalyticsChart />
          </CardContent>
        </Card>

        {/* Frame Visualizer */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle>Frame Stack</CardTitle>
            <CardDescription>Call stack visualization</CardDescription>
          </CardHeader>
          <CardContent>
            <FrameVisualizer />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}