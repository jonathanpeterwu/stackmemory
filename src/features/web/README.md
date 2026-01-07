# StackMemory Web Dashboard

A modern web interface for StackMemory, providing real-time monitoring and management of tasks, sessions, frames, and integrations.

## Architecture

### Tech Stack
- **Frontend**: Next.js 14 with App Router
- **UI**: React 18 + Tailwind CSS + shadcn/ui
- **State**: Zustand for client state
- **Real-time**: Socket.io for WebSocket communication
- **Charts**: Recharts for analytics visualization
- **Backend**: Express server with Socket.io

### Features
- ✅ Real-time task monitoring (Linear sync)
- ✅ Live session tracking
- ✅ Frame visualization
- ✅ PR/Issue tracking
- ✅ Analytics dashboard
- ✅ Dark/Light mode
- ✅ Responsive design

### Directory Structure
```
src/features/web/
├── README.md                 # This file
├── server/                   # Backend server
│   ├── index.ts             # Express + Socket.io server
│   ├── routes/              # API routes
│   └── services/            # Data services (reused from TUI)
├── client/                  # Next.js app
│   ├── app/                 # App router pages
│   ├── components/          # React components
│   ├── lib/                 # Utilities
│   └── styles/             # Global styles
└── shared/                  # Shared types and utilities
```

## Components

### Dashboard Layout
- **Header**: Navigation, search, user menu
- **Sidebar**: Quick access to main sections
- **Main Content**: Dynamic panels based on route

### Main Sections
1. **Overview**: Summary cards and key metrics
2. **Tasks**: Linear task board with filters
3. **Sessions**: Active and recent sessions
4. **Frames**: Call stack visualization
5. **Analytics**: Charts and insights
6. **Settings**: Configuration and preferences

## Development

### Setup
```bash
# Install dependencies
npm install

# Run development server
npm run dev:web

# Build for production
npm run build:web

# Start production server
npm run start:web
```

### Environment Variables
```env
NEXT_PUBLIC_WS_URL=ws://localhost:8080
PORT=3000
WS_PORT=8080
```

## API Endpoints

### REST API
- `GET /api/tasks` - Get all tasks
- `GET /api/sessions` - Get sessions
- `GET /api/frames` - Get frames
- `GET /api/analytics` - Get analytics data

### WebSocket Events
- `tasks:update` - Task updates
- `session:start` - New session started
- `session:end` - Session ended
- `frame:push` - New frame pushed
- `frame:pop` - Frame popped

## Deployment

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --production
RUN npm run build:web
EXPOSE 3000 8080
CMD ["npm", "run", "start:web"]
```

### Railway/Vercel
- Deploy Next.js app to Vercel
- Deploy WebSocket server to Railway
- Configure CORS and environment variables