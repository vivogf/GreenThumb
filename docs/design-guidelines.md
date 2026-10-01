# GreenThumb PWA Design Guidelines

## Design Approach
**Zen Minimalist** - A calm, nature-inspired aesthetic prioritizing clarity, plant imagery, and peaceful interactions. Drawing inspiration from mobile-first productivity apps with heavy visual content (similar to plant care apps like Planta, combined with Material Design's structured approach).

## Core Design Elements

### A. Typography
- **Font Family**: Roboto (Material UI standard)
- **Hierarchy**:
  - Page Titles: Roboto Medium, 24px
  - Card Titles/Plant Names: Roboto Regular, 18px
  - Body Text: Roboto Regular, 14px
  - Labels/Metadata: Roboto Light, 12px

### B. Color System
- **Primary**: `#2E7D32` (Forest Green) - Main actions, active states
- **Secondary**: `#81C784` (Light Green) - Success states, secondary actions
- **Background**: `#F5F5F5` (Light Grey) for app background
- **Surface**: White for cards and elevated components
- **Alert**: Soft Red for overdue plants/warnings
- **Text**: MUI default text colors (dark grey on light backgrounds)

### C. Layout System
**Spacing**: Material UI's 8px grid system (use MUI spacing tokens: 1, 2, 3, 4, 6, 8)
- Card padding: 16px (2 units)
- Section spacing: 24px (3 units)
- Component gaps: 8px-16px (1-2 units)

**Mobile-First Breakpoints**:
- Mobile: 360px-599px (single column)
- Tablet: 600px-959px (2 columns where appropriate)
- Desktop: 960px+ (3 columns for plant grids)

### D. Component Library

#### Navigation
- **Mobile** (< 960px): Bottom Navigation Bar fixed at bottom
  - 3 items: Dashboard (home icon), Add Plant (+ icon), Profile (person icon)
  - Active state uses Primary color
  - Height: 56px
- **Desktop** (≥ 960px): Top App Bar
  - Logo left, navigation center, profile right
  - Height: 64px

#### Plant Cards (Primary Component)
- **Layout**: Vertical card with large image emphasis
- **Image**: 
  - Full-width, 200px height on mobile
  - Aspect ratio 16:9, cover fit
  - Skeleton loader while loading
- **Content Section** (below image):
  - Plant name (prominent, 18px)
  - Location badge/chip (small, grey background)
  - Next watering indicator (date-fns formatted)
  - Notes preview (2 lines max, truncated)
- **Action Button**: 
  - "WATER" button - full-width, Primary color
  - Elevated style (contained button)
  - Changes to Light Green on optimistic update
  - Disabled state when recently watered

#### Status Indicators
- **Need Water Section**: 
  - Header with urgent orange/red accent
  - Cards show "Overdue by X days" or "Due today"
- **All Good Section**:
  - Calm header with green accent
  - Cards show "Next watering in X days"

#### Forms (Add Plant)
- Standard Material UI text fields
- Vertical layout with 16px spacing
- Labels above fields
- Photo URL field with preview
- Frequency input (number with "days" suffix)
- Submit button: Primary color, elevated

#### Loading States
- Use MUI Skeleton components extensively
- Card skeleton: Image rectangle + 3 text lines
- Maintain layout structure during loading

### E. Images
**Plant Photos**: The visual centerpiece of the application
- **Location**: Each plant card features a large prominent photo
- **Style**: Full-width, rounded corners (8px border-radius on cards)
- **Placeholder**: Skeleton loader during fetch, fallback to plant icon if URL invalid
- **Emphasis**: Photos are intentionally large to create emotional connection

**No Hero Image**: This is a utility app, not a marketing site. Dashboard starts directly with content.

### F. Interactions
- **Water Button Click**:
  - Immediate optimistic UI update (green state)
  - Ripple effect on tap
  - No hover effects needed (mobile-first)
- **Card Tap**: Navigate to plant details
- **Smooth Transitions**: 200ms for state changes
- **Pull-to-refresh**: Native mobile pattern on dashboard

### G. Responsive Behavior
- **Mobile**: Single column stack, bottom navigation
- **Tablet**: 2-column grid for plant cards
- **Desktop**: 3-column grid, top navigation, wider max-width (1200px)

## Key UX Principles
1. **Image-First**: Plant photos dominate the interface
2. **Instant Feedback**: Optimistic updates make watering feel immediate
3. **Smart Sorting**: Automatically prioritize plants needing attention
4. **Minimal Friction**: Large tap targets, clear CTAs
5. **Loading Grace**: Always show skeleton states, never blank screens
6. **Data Isolation**: Clean authentication flow, no manual user filtering in UI logic