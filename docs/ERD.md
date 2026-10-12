# Entity Relationship Diagram (ERD)

Diagram konseptual untuk membantu memahami domain data. Migration SQL adalah detail implementasi awal; diagram ini bukan pengganti pemeriksaan schema aktual.

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : owns
  PROFILES ||--o{ MOTORCYCLES : has
  MOTORCYCLES ||--o| MOTORCYCLE_PRIVATE_DETAILS : private_details
  PROFILES ||--o{ CLUBS : creates
  CLUBS ||--o{ CLUB_MEMBERS : has
  PROFILES ||--o{ CLUB_MEMBERS : joins
  CLUBS ||--o{ RIDES : hosts
  PROFILES ||--o{ RIDES : creates
  RIDES ||--o{ RIDE_MEMBERS : has
  PROFILES ||--o{ RIDE_MEMBERS : joins
  RIDES ||--o{ RIDE_LOCATIONS : current_positions
  PROFILES ||--o{ RIDE_LOCATIONS : reports_position
  RIDES ||--o{ CHAT_MESSAGES : contains
  PROFILES ||--o{ CHAT_MESSAGES : writes
  PROFILES ||--o{ HAZARD_REPORTS : reports
  RIDES o|--o{ HAZARD_REPORTS : contextualizes
  CLUBS ||--o{ CLUB_POSTS : contains
  PROFILES ||--o{ CLUB_POSTS : writes
  CLUB_POSTS ||--o{ POST_COMMENTS : has
  CLUB_POSTS ||--o{ POST_REACTIONS : has
  PROFILES ||--o{ POST_COMMENTS : writes
  PROFILES ||--o{ POST_REACTIONS : reacts
  PROFILES ||--o{ FOLLOWS : follows
  PROFILES ||--o{ USER_BLOCKS : blocks
  PROFILES ||--o{ CONTENT_REPORTS : reports_content
  PROFILES ||--o{ NOTIFICATIONS : receives
  PROFILES ||--o{ PUSH_TOKENS : registers
```

## Catatan akses

- `profiles` berisi field profil yang aman saja; jangan menambahkan email atau data privat ke tabel ini tanpa meninjau RLS.
- `motorcycle_private_details` menyimpan plat nomor dan hanya dapat dibaca pemilik.
- `ride_locations` adalah posisi terakhir yang diperlukan selama ride aktif, bukan history trail default.
- Membership klub dan ride adalah sumber otorisasi untuk data privat.
- Voice room, media object storage, audit log, dan analytics provider dapat memiliki resource non-relasional tersendiri; secrets tidak pernah masuk tabel yang dibaca mobile.
