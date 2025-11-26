# GreenThumb - Plant Care Tracker

## Overview

GreenThumb is a mobile-first Progressive Web App (PWA) designed to help users track and manage their plant watering schedules. The application provides a clean, zen-minimalist interface focused on visual plant imagery and intuitive watering reminders. Built with React and TypeScript, it uses Replit PostgreSQL for data storage and custom email-based authentication with secure server-side sessions.

The app intelligently sorts plants by watering needs, showing overdue and due-today plants first, with optimistic UI updates for immediate user feedback when watering plants.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Core Technology Stack:**
- React 18+ with TypeScript for type safety
- Vite as the build tool and development server
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and caching

**UI Framework:**
- Radix UI primitives for accessible, unstyled components
- Tailwind CSS for utility-first styling with custom design tokens
- shadcn/ui component library following the "new-york" style variant
- Custom CSS variables for theming (light mode with nature-inspired green palette)

**Design System:**
- **Theme**: Zen Minimalist with nature-inspired aesthetics
- **Color Palette**: Forest Green primary (#2E7D32), Light Green secondary (#81C784), Light Grey backgrounds (#F5F5F5)
- **Typography**: Roboto font family (Material UI standard)
- **Responsive Layout**: Mobile-first approach with breakpoints at 768px and 960px
- **Navigation**: Bottom navigation bar on mobile (<960px), top app bar on desktop

**State Management Pattern:**
- React Context API for authentication state (AuthContext)
- TanStack Query for server state, data fetching, and cache management
- Optimistic updates for plant watering actions to provide instant UI feedback
- Local component state using React hooks for form handling

**Routing Structure:**
- `/login` - Authentication page with email/password (public)
- `/` - Dashboard with plant list (protected)
- `/add-plant` - Form to add new plants (protected)
- `/plant/:id` - Individual plant details (protected)
- `/profile` - User profile and settings (protected)

All protected routes use a `ProtectedRoute` wrapper component that enforces authentication.

### Backend Architecture

**Server Framework:**
- Express.js with TypeScript
- Separate development (`index-dev.ts`) and production (`index-prod.ts`) entry points
- Vite middleware integration for development with HMR support
- Static file serving in production from the `dist/public` directory

**API Design:**
- RESTful API with `/api` prefix for all endpoints
- Authentication endpoints: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Plant CRUD endpoints: `/api/plants` (GET, POST), `/api/plants/:id` (PATCH, DELETE)
- All plant endpoints protected with `requireAuth` middleware
- Request logging middleware tracking response times and JSON payloads

**Data Storage:**
- Replit PostgreSQL database
- Drizzle ORM configured for PostgreSQL dialect
- Schema definition in `shared/schema.ts` for type-safe data models
- Database credentials managed via `DATABASE_URL` environment variable

### Authentication & Authorization

**Authentication System:**
- Custom email/password authentication
- Passwords hashed with bcryptjs (salt rounds: 10)
- Server-side sessions using express-session with memorystore
- HttpOnly cookies for secure session management
- 7-day session expiry

**API Endpoints:**
- `POST /api/auth/register` - Create new user account
- `POST /api/auth/login` - Authenticate user, create session
- `POST /api/auth/logout` - Destroy session
- `GET /api/auth/me` - Get current authenticated user

**Authorization Strategy:**
- Server-side session validation on every protected request
- `requireAuth` middleware protects plant endpoints
- User ID stored in session, not in client-side storage
- Protected routes redirect unauthenticated users to `/login`

**User Session Flow:**
1. User submits email/password to register or login
2. Server validates credentials and creates session
3. Session ID stored in HttpOnly cookie
4. `AuthContext` checks `/api/auth/me` on page load
5. Protected routes check authentication status before rendering

### Data Schema

**Users Table:**
```typescript
{
  id: serial (primary key, auto-increment)
  email: text (unique, not null)
  password: text (bcrypt hash, not null)
  name: text (optional)
  created_at: timestamp (default now)
}
```

**Plants Table:**
```typescript
{
  id: uuid (primary key, auto-generated)
  user_id: text (not null, references user id)
  name: text (not null)
  location: text (not null)
  photo_url: text (not null, can be base64 data URI)
  water_frequency_days: integer (not null)
  last_watered_date: timestamp (not null)
  notes: text (optional)
}
```

**Validation:**
- Zod schema validation for user registration (`registerSchema`)
- Zod schema validation for login (`loginSchema`)
- Zod schema validation for plant creation (`insertPlantSchema`)
- React Hook Form with Zod resolver for client-side form validation
- Password minimum: 6 characters

**Business Logic:**
- Next watering date calculated as: `last_watered_date + water_frequency_days`
- Plants categorized as: Overdue (past due), Due Today, or All Good (future)
- Dashboard sorting prioritizes plants needing water first

## External Dependencies

### Database

**Replit PostgreSQL:**
- Hosted PostgreSQL instance provided by Replit
- Direct connection via `DATABASE_URL` environment variable
- Schema managed via Drizzle ORM and `npm run db:push`
- Storage limit: 10 GiB per database

### Key NPM Packages

**Authentication:**
- `express-session` - Server-side session management
- `memorystore` - Session store for development
- `bcryptjs` - Password hashing

**UI & Styling:**
- `@radix-ui/*` - Accessible component primitives (20+ components)
- `tailwindcss` - Utility-first CSS framework
- `class-variance-authority` - Type-safe component variants
- `clsx` + `tailwind-merge` - Conditional class name utilities

**Data Fetching & Forms:**
- `@tanstack/react-query` - Server state management and caching
- `react-hook-form` - Performant form handling
- `@hookform/resolvers` - Integration with Zod validation
- `zod` - TypeScript-first schema validation
- `drizzle-zod` - Generate Zod schemas from Drizzle schema

**Date Handling:**
- `date-fns` - Comprehensive date utility library for watering calculations

**Routing:**
- `wouter` - Lightweight routing library (2KB alternative to React Router)

**Icons:**
- `lucide-react` - Consistent icon library

### Build & Development Tools

- **Vite**: Fast build tool with HMR, plugin ecosystem
- **TypeScript**: Type safety across client and server
- **ESBuild**: Production server bundling
- **PostCSS + Autoprefixer**: CSS processing pipeline
- **Drizzle Kit**: Database schema management and migrations

### Environment Variables

**Required Secrets:**
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secret for signing session cookies

**Database Secrets (auto-provided):**
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

### Development-Only Dependencies

- `@replit/vite-plugin-runtime-error-modal` - Error overlay for development
- `@replit/vite-plugin-cartographer` - Replit integration
- `@replit/vite-plugin-dev-banner` - Development environment indicator
