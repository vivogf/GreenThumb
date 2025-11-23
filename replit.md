# GreenThumb - Plant Care Tracker

## Overview

GreenThumb is a mobile-first Progressive Web App (PWA) designed to help users track and manage their plant watering schedules. The application provides a clean, zen-minimalist interface focused on visual plant imagery and intuitive watering reminders. Built with React and TypeScript, it leverages Supabase for authentication and data storage, ensuring secure, user-isolated plant management.

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
- `/login` - Authentication page (public)
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
- Currently using direct Supabase client-side integration (no custom API endpoints)
- Server routes registered through `registerRoutes` function in `routes.ts`
- Request logging middleware tracking response times and JSON payloads

**Data Storage:**
- Drizzle ORM configured for PostgreSQL dialect
- Schema definition in `shared/schema.ts` for type-safe data models
- Database credentials managed via `DATABASE_URL` environment variable
- Migration files stored in `./migrations` directory

### Authentication & Authorization

**Authentication Provider:**
- Supabase Auth for user authentication
- Email/password authentication flow
- Session management with automatic token refresh
- Authentication state managed through React Context

**Authorization Strategy:**
- Row Level Security (RLS) enforced at the database level in Supabase
- Client trusts backend RLS policies - no manual user_id filtering in queries
- All plant queries automatically filtered by Supabase to return only user's data
- Protected routes redirect unauthenticated users to `/login`

**User Session Flow:**
1. User credentials validated by Supabase Auth
2. Session token stored and managed by Supabase client
3. `AuthContext` monitors session state changes
4. Protected routes check authentication status before rendering

### Data Schema

**Plants Table:**
```typescript
{
  id: string (uuid, primary key)
  user_id: string (uuid, references auth.users)
  name: string
  location: string
  photo_url: string
  water_frequency_days: number
  last_watered_date: string (ISO timestamp)
  notes: string (optional)
}
```

**Validation:**
- Zod schema validation for plant creation (`insertPlantSchema`)
- React Hook Form with Zod resolver for client-side form validation
- Required fields: name, location, photo_url, water_frequency_days
- Notes field is optional with empty string default

**Business Logic:**
- Next watering date calculated as: `last_watered_date + water_frequency_days`
- Plants categorized as: Overdue (past due), Due Today, or All Good (future)
- Dashboard sorting prioritizes plants needing water first

## External Dependencies

### Third-Party Services

**Supabase (Primary Backend Service):**
- **Purpose**: Backend-as-a-Service providing authentication and PostgreSQL database
- **Integration**: Client-side SDK (`@supabase/supabase-js`)
- **Configuration**: Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables
- **Features Used**:
  - Auth: Email/password authentication with session management
  - Database: PostgreSQL with Row Level Security
  - Real-time: Potential for live updates (infrastructure present but not actively used)

### Database

**PostgreSQL (via Supabase):**
- Hosted PostgreSQL instance managed by Supabase
- Row Level Security (RLS) policies enforce data isolation per user
- Accessed via Supabase client SDK, not direct connection
- Drizzle ORM configured but primarily using Supabase client for queries

**Potential PostgreSQL Setup:**
- Application includes `@neondatabase/serverless` package
- Drizzle configuration supports direct PostgreSQL connection via `DATABASE_URL`
- Current implementation relies on Supabase; direct PostgreSQL may be added later

### Key NPM Packages

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

### Development-Only Dependencies

- `@replit/vite-plugin-runtime-error-modal` - Error overlay for development
- `@replit/vite-plugin-cartographer` - Replit integration
- `@replit/vite-plugin-dev-banner` - Development environment indicator