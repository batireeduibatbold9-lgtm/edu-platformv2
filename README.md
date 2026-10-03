# EDU+ v2 — School LMS UI

Энэ хувилбар нь өмнөх starter платформ дээр суурилсан илүү албан ёсны сургуулийн LMS интерфэйс юм.

## Шинэчлэлт
- Modern responsive school LMS UI
- Admin role + admin dashboard
- User role management (student / teacher / admin)
- Institution overview: users, teachers, students, classes, exams
- Admin reports / performance overview
- Improved teacher/student navigation
- Profile popover/modal
- Mongolian UI
- Cleaner tables, cards, responsive mobile layout
- Existing Supabase authentication, RLS, classes, subjects, lessons, materials and exams retained
- Admin RLS policies added

## Setup
1. Supabase SQL Editor дээр `supabase/schema.sql`-ийг ажиллуул.
2. `js/config.js` дээр Supabase URL + anon key оруул.
3. `index.html`-ийг Live Server/static hosting-оор ажиллуул.
4. Эхний admin хэрэглэгчийг бүртгүүлсний дараа Supabase `profiles` хүснэгт дээр role-ийг `admin` болго.

> Frontend-д service-role key бүү оруул. Зөвхөн anon key ашиглаж, RLS-ийг идэвхтэй байлга.
