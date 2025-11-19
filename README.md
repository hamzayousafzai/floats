# Floats App

A local event discovery and management platform built with Next.js and Supabase.

## Tech Stack

- **Framework:** [Next.js 15](https://nextjs.org/) (App Router)
- **Language:** TypeScript
- **Database & Auth:** [Supabase](https://supabase.com/) (PostgreSQL)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/)
- **Maps:** MapLibre GL JS
- **Deployment:** Vercel

## Getting Started

1.  **Clone the repository**

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Environment Setup**
    Create a `.env.local` file in the root directory with the following keys:
    ```bash
    NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
    SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
    ```

4.  **Run the development server**
    ```bash
    npm run dev
    ```
    Open [http://localhost:3000](http://localhost:3000) to view the app.

## Project Structure

- **`app/`**: Next.js App Router pages and API routes.
    - `(app)/`: Main user-facing application (Explore, Map, Profile).
    - `admin/`: Internal admin panel for managing events and orgs.
    - `host/`: Vendor/Host dashboard.
    - `api/`: Backend API endpoints (Cron jobs, search, uploads).
- **`components/`**: Reusable UI components, organized by feature (e.g., `map`, `profile`, `explore`).
- **`lib/`**: Shared utilities, database types, and helper functions.
    - `database.types.ts`: Generated Supabase TypeScript definitions.

## Key Features

- **Explore:** List and map views for discovering local events.
- **User Profile:** Favorites, check-ins, and badge tracking.
- **Admin Panel:** Comprehensive management for global admins (Events, Orgs, Users).
- **Host Dashboard:** Tools for vendors to manage their own events and analytics.
- **Notifications:** Automated cron jobs for event reminders (48hr & Start).

## Database Management

This project uses Supabase. Database types are generated automatically. To update types after a schema change:

```bash
npx supabase gen types typescript --project-id "your-project-id" > lib/database.types.ts