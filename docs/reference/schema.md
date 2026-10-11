# Reference: databaseskema

> Genereret af `scripts/gen-reference.mjs` (`npm run docs:reference`). Redigér ikke i hånden — ret koden eller migrationerne og generér igen.

Udledt af 27 migrationer i `supabase/migrations/` ved at læse `create table`, `alter table`, `create policy`/`drop policy`, `create type`, `create view`, `create function` og `create trigger` i filrækkefølge. Det der ikke genkendes er talt nederst — ikke gættet. Indekser, `grant`/`revoke` og data-sætninger er ikke udledt.

## Overblik

- Tabeller: **30**, heraf RLS slået til: **30**
- Tabeller uden `enable row level security`: **ingen**
- RLS slået til men uden nogen policy (alt afvises for klientroller; kun service-role): ingen
- Policies i alt: **64**
- Views: 1 · Enum-typer: 15 · Funktioner: 6 · Triggere: 1

| Tabel | Kolonner | RLS | Policies | Oprettet i |
|---|---|---|---|---|
| [app_user](#app_user) | 6 | ja | 2 | 0001_roles.sql |
| [board](#board) | 5 | ja | 3 | 0002_board.sql |
| [board_change](#board_change) | 9 | ja | 1 | 0025_board_change.sql |
| [board_partner](#board_partner) | 3 | ja | 3 | 0002_board.sql |
| [competence_tag](#competence_tag) | 5 | ja | 1 | 0005_competence_tags.sql |
| [fee_rule](#fee_rule) | 8 | ja | 2 | 0017_partner_fee.sql |
| [meeting](#meeting) | 11 | ja | 3 | 0012_meeting.sql |
| [meeting_agenda_item](#meeting_agenda_item) | 7 | ja | 3 | 0015_preparation_and_rating.sql |
| [meeting_note](#meeting_note) | 5 | ja | 3 | 0012_meeting.sql |
| [meeting_partner](#meeting_partner) | 4 | ja | 3 | 0012_meeting.sql |
| [meeting_prep_note](#meeting_prep_note) | 6 | ja | 2 | 0015_preparation_and_rating.sql |
| [meeting_rating](#meeting_rating) | 9 | ja | 3 | 0015_preparation_and_rating.sql |
| [meeting_summary](#meeting_summary) | 12 | ja | 2 | 0022_meeting_summary.sql |
| [meeting_webhook_event](#meeting_webhook_event) | 6 | ja | 1 | 0012_meeting.sql |
| [membership](#membership) | 12 | ja | 2 | 0013_payment.sql |
| [notification_delivery](#notification_delivery) | 13 | ja | 1 | 0021_notification_template.sql |
| [notification_template](#notification_template) | 11 | ja | 1 | 0021_notification_template.sql |
| [partner_absence](#partner_absence) | 6 | ja | 2 | 0018_partner_availability.sql |
| [partner_availability](#partner_availability) | 6 | ja | 2 | 0018_partner_availability.sql |
| [partner_profile](#partner_profile) | 14 | ja | 4 | 0009_partner_profile.sql |
| [partner_profile_competence_tag](#partner_profile_competence_tag) | 2 | ja | 3 | 0009_partner_profile.sql |
| [payment_charge](#payment_charge) | 16 | ja | 2 | 0013_payment.sql |
| [payment_webhook_event](#payment_webhook_event) | 6 | ja | 1 | 0013_payment.sql |
| [pricing_rule](#pricing_rule) | 10 | ja | 2 | 0013_payment.sql |
| [quiz_answer](#quiz_answer) | 5 | ja | 4 | 0008_quiz_answer.sql |
| [quiz_option](#quiz_option) | 7 | ja | 2 | 0007_quiz.sql |
| [quiz_option_competence_tag](#quiz_option_competence_tag) | 2 | ja | 2 | 0007_quiz.sql |
| [quiz_question](#quiz_question) | 8 | ja | 2 | 0007_quiz.sql |
| [rating_link](#rating_link) | 7 | ja | 1 | 0023_rating_link.sql |
| [user_role_assignment](#user_role_assignment) | 2 | ja | 1 | 0001_roles.sql |

## Tabeller

### app_user

Oprettet i `0001_roles.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej |  | primær nøgle |
| `email` | `text` | nej |  | unik |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `display_name` | `text` | ja |  |  |
| `phone_e164` | `text` | ja |  |  |
| `time_zone` | `text` | nej | `'Europe/Copenhagen'` |  |

Tabelkonstraints:

- `constraint app_user_display_name_valid check ( display_name is null or (char_length(btrim(display_name)) between 1 and 100 and display_name !~ '[[:cntrl:]]') )`
- `constraint app_user_phone_e164_format check ( phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$' )`
- `constraint app_user_time_zone_format check ( time_zone = 'UTC' or time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$' )`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `app_user_select_self` | select | alle | `id = auth.uid()` |  |
| `app_user_select_admin` | select | alle | `has_role('admin')` |  |

### board

Oprettet i `0002_board.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `owner_id` | `uuid` | nej |  | → app_user(id) on delete cascade |
| `name` | `text` | nej |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `calcom_event_type_id` | `integer` | ja |  | check calcom_event_type_id is null or calcom_event_type_id > 0 |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `board_select_owner` | select | alle | `owner_id = auth.uid()` |  |
| `board_select_admin` | select | alle | `exists ( select 1 from user_role_assignment ura where ura.user_id = auth.uid() and ura.role = 'admin' )` |  |
| `board_select_partner` | select | alle | `is_partner_on_board(board.id)` |  |

### board_change

Oprettet i `0025_board_change.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `board_id` | `uuid` | nej |  | → board(id) on delete cascade |
| `actor_id` | `uuid` | ja |  | → app_user(id) on delete set null |
| `actor_role` | `text` | nej |  | check actor_role in ('ejer', 'admin') |
| `action` | `text` | nej |  | check action in ('tilfoej', 'fjern', 'udskift', 'saet_lead', 'opdater_hosts') |
| `partner_id` | `uuid` | ja |  | → partner_profile(id) on delete set null |
| `replaced_partner_id` | `uuid` | ja |  | → partner_profile(id) on delete set null |
| `calcom_sync` | `text` | nej |  | check calcom_sync in ('opdateret', 'fejlet', 'sprunget_over') |
| `created_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `board_change_select_admin` | select | alle | `has_role('admin')` |  |

### board_partner

Oprettet i `0002_board.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `board_id` | `uuid` | nej |  | → board(id) on delete cascade |
| `partner_id` | `uuid` | nej |  | → app_user(id) on delete cascade |
| `is_lead` | `boolean` | nej | `false` |  |

Tabelkonstraints:

- `primary key (board_id, partner_id)`
- `constraint board_partner_partner_id_fkey foreign key (partner_id) references partner_profile(id) on delete cascade`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `board_partner_select_owner` | select | alle | `exists ( select 1 from board b where b.id = board_partner.board_id and b.owner_id = auth.uid() )` |  |
| `board_partner_select_admin` | select | alle | `has_role('admin')` |  |
| `board_partner_select_partner` | select | alle | `is_partner_on_board(board_partner.board_id)` |  |

### competence_tag

Oprettet i `0005_competence_tags.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `slug` | `text` | nej |  | unik |
| `label` | `text` | nej |  |  |
| `sort_order` | `int` | nej | `0` |  |
| `created_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `competence_tag_select_authenticated` | select | alle | `auth.uid() is not null` |  |

### fee_rule

Oprettet i `0017_partner_fee.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `version` | `int` | nej |  | unik |
| `hourly_rate_minor` | `int` | nej |  | check hourly_rate_minor >= 0 |
| `currency` | `text` | nej | `'DKK'` |  |
| `vat_mode` | `fee_vat_mode` | nej | `'ikke_fastlagt'` |  |
| `absence_rule` | `fee_absence_rule` | nej | `'ikke_fastlagt'` |  |
| `effective_from` | `timestamptz` | nej |  | unik |
| `created_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `fee_rule_select_admin` | select | alle | `has_role('admin')` |  |
| `fee_rule_select_partner` | select | alle | `has_role('partner') or has_role('lead_partner')` |  |

### meeting

Oprettet i `0012_meeting.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `board_id` | `uuid` | nej |  | → board(id) on delete cascade |
| `provider` | `text` | nej | `'calcom'` |  |
| `provider_booking_uid` | `text` | ja |  | unik |
| `starts_at` | `timestamptz` | nej |  |  |
| `duration_minutes` | `int` | nej | `60` |  |
| `prep_minutes` | `int` | nej | `15` |  |
| `status` | `meeting_status` | nej | `'planlagt'` |  |
| `video_join_url` | `text` | ja |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_select_owner` | select | alle | `exists (select 1 from board b where b.id = meeting.board_id and b.owner_id = auth.uid())` |  |
| `meeting_select_partner` | select | alle | `is_partner_on_board(meeting.board_id)` |  |
| `meeting_select_admin` | select | alle | `has_role('admin')` |  |

### meeting_agenda_item

Oprettet i `0015_preparation_and_rating.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `meeting_id` | `uuid` | nej |  | → meeting(id) on delete cascade |
| `kind` | `agenda_item_kind` | nej |  |  |
| `body` | `text` | nej |  |  |
| `sort_order` | `int` | nej | `0` |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_agenda_item_select_owner` | select | alle | `exists ( select 1 from meeting m join board b on b.id = m.board_id where m.id = meeting_agenda_item.meeting_id and b.owner_id = auth.uid() )` |  |
| `meeting_agenda_item_select_partner` | select | alle | `exists ( select 1 from meeting m where m.id = meeting_agenda_item.meeting_id and is_partner_on_board(m.board_id) )` |  |
| `meeting_agenda_item_select_admin` | select | alle | `has_role('admin')` |  |

### meeting_note

Oprettet i `0012_meeting.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `meeting_id` | `uuid` | nej |  | → meeting(id) on delete cascade |
| `partner_profile_id` | `uuid` | nej |  | → partner_profile(id) on delete cascade |
| `body` | `text` | nej |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `unique (meeting_id, partner_profile_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_note_select_author` | select | alle | `exists ( select 1 from partner_profile pp where pp.id = meeting_note.partner_profile_id and pp.app_user_id = auth.uid() )` |  |
| `meeting_note_select_owner` | select | alle | `exists ( select 1 from meeting m join board b on b.id = m.board_id where m.id = meeting_note.meeting_id and b.owner_id = auth.uid() )` |  |
| `meeting_note_select_admin` | select | alle | `has_role('admin')` |  |

### meeting_partner

Oprettet i `0012_meeting.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `meeting_id` | `uuid` | nej |  | → meeting(id) on delete cascade |
| `partner_profile_id` | `uuid` | nej |  | → partner_profile(id) on delete cascade |
| `registered_status` | `meeting_registered_status` | ja |  |  |
| `registered_at` | `timestamptz` | ja |  |  |

Tabelkonstraints:

- `primary key (meeting_id, partner_profile_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_partner_select_owner` | select | alle | `exists ( select 1 from meeting m join board b on b.id = m.board_id where m.id = meeting_partner.meeting_id and b.owner_id = auth.uid() )` |  |
| `meeting_partner_select_partner` | select | alle | `exists ( select 1 from meeting m where m.id = meeting_partner.meeting_id and is_partner_on_board(m.board_id) )` |  |
| `meeting_partner_select_admin` | select | alle | `has_role('admin')` |  |

### meeting_prep_note

Oprettet i `0015_preparation_and_rating.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `meeting_id` | `uuid` | nej |  | → meeting(id) on delete cascade |
| `partner_profile_id` | `uuid` | nej |  | → partner_profile(id) on delete cascade |
| `body` | `text` | nej |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `unique (meeting_id, partner_profile_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_prep_note_select_author` | select | alle | `exists ( select 1 from partner_profile pp where pp.id = meeting_prep_note.partner_profile_id and pp.app_user_id = auth.uid() )` |  |
| `meeting_prep_note_select_admin` | select | alle | `has_role('admin')` |  |

### meeting_rating

Oprettet i `0015_preparation_and_rating.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `meeting_id` | `uuid` | nej |  | → meeting(id) on delete cascade |
| `rater_user_id` | `uuid` | ja |  | → app_user(id) on delete cascade |
| `rater_partner_profile_id` | `uuid` | ja |  | → partner_profile(id) on delete cascade |
| `subject_partner_profile_id` | `uuid` | ja |  | → partner_profile(id) on delete cascade |
| `score` | `smallint` | nej |  | check score between 1 and 5 |
| `comment` | `text` | ja |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `constraint meeting_rating_one_rater check (num_nonnulls(rater_user_id, rater_partner_profile_id) = 1)`
- `constraint meeting_rating_unique_per_subject unique nulls not distinct (meeting_id, rater_user_id, rater_partner_profile_id, subject_partner_profile_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_rating_select_rater_owner` | select | alle | `rater_user_id = auth.uid()` |  |
| `meeting_rating_select_rater_partner` | select | alle | `exists ( select 1 from partner_profile pp where pp.id = meeting_rating.rater_partner_profile_id and pp.app_user_id = auth.uid() )` |  |
| `meeting_rating_select_admin` | select | alle | `has_role('admin')` |  |

### meeting_summary

Oprettet i `0022_meeting_summary.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `meeting_id` | `uuid` | nej |  | unik; → meeting(id) on delete cascade |
| `status` | `meeting_summary_status` | nej | `'afventer'` |  |
| `summary` | `text` | ja |  |  |
| `action_items` | `jsonb` | nej | `'[]'::jsonb` |  |
| `provider` | `text` | ja |  |  |
| `model` | `text` | ja |  |  |
| `error` | `text` | ja |  |  |
| `attempts` | `int` | nej | `0` | check attempts >= 0 |
| `generated_at` | `timestamptz` | ja |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `constraint meeting_summary_action_items_array check (jsonb_typeof(action_items) = 'array')`
- `constraint meeting_summary_klar_has_text check (status <> 'klar' or (summary is not null and generated_at is not null))`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_summary_select_owner` | select | alle | `exists ( select 1 from meeting m join board b on b.id = m.board_id where m.id = meeting_summary.meeting_id and b.owner_id = auth.uid() )` |  |
| `meeting_summary_select_admin` | select | alle | `has_role('admin')` |  |

### meeting_webhook_event

Oprettet i `0012_meeting.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `provider` | `text` | nej | `'calcom'` |  |
| `provider_event_id` | `text` | nej |  |  |
| `event_type` | `text` | nej |  |  |
| `provider_booking_uid` | `text` | ja |  |  |
| `received_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `unique (provider, provider_event_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `meeting_webhook_event_select_admin` | select | alle | `has_role('admin')` |  |

### membership

Oprettet i `0013_payment.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `board_id` | `uuid` | nej |  | unik; → board(id) on delete cascade |
| `frequency_weeks` | `int` | nej |  | check frequency_weeks in (4, 8, 12) |
| `status` | `membership_status` | nej | `'aktiv'` |  |
| `provider` | `text` | nej | `'alunta'` |  |
| `provider_customer_ref` | `text` | ja |  |  |
| `card_status` | `membership_card_status` | nej | `'mangler'` |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |
| `billing_anchor` | `date` | ja |  |  |
| `cancelled_at` | `date` | ja |  |  |
| `provider_subscription_ref` | `text` | ja |  |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `membership_select_owner` | select | alle | `exists (select 1 from board b where b.id = membership.board_id and b.owner_id = auth.uid())` |  |
| `membership_select_admin` | select | alle | `has_role('admin')` |  |

### notification_delivery

Oprettet i `0021_notification_template.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `type_key` | `text` | nej |  | check type_key ~ '^[a-z][a-z0-9-]*$' |
| `channel` | `notification_channel` | nej |  |  |
| `recipient_user_id` | `uuid` | nej |  | → app_user(id) on delete cascade |
| `related_id` | `uuid` | ja |  |  |
| `template_id` | `uuid` | ja |  | → notification_template(id) |
| `status` | `notification_delivery_status` | nej | `'afventer'` |  |
| `attempt` | `int` | nej | `0` | check attempt >= 0 |
| `error` | `text` | ja |  |  |
| `provider_ref` | `text` | ja |  |  |
| `idempotency_key` | `text` | nej |  | unik; check btrim(idempotency_key) <> '' |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `notification_delivery_select_admin` | select | alle | `has_role('admin')` |  |

### notification_template

Oprettet i `0021_notification_template.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `type_key` | `text` | nej |  | check type_key ~ '^[a-z][a-z0-9-]*$' |
| `channel` | `notification_channel` | nej |  |  |
| `version` | `int` | nej |  | check version >= 1 |
| `status` | `notification_template_status` | nej | `'udkast'` |  |
| `subject` | `text` | ja |  |  |
| `body` | `text` | nej |  | check btrim(body) <> '' |
| `published_at` | `timestamptz` | ja |  |  |
| `published_by` | `uuid` | ja |  | → app_user(id) on delete set null |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `unique (type_key, channel, version)`
- `constraint notification_template_subject_by_channel check ( (channel = 'email' and subject is not null and btrim(subject) <> '') or (channel = 'sms' and subject is null) )`
- `constraint notification_template_published_when_not_draft check ( (status = 'udkast') = (published_at is null) )`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `notification_template_select_admin` | select | alle | `has_role('admin')` |  |

### partner_absence

Oprettet i `0018_partner_availability.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `partner_profile_id` | `uuid` | nej |  | → partner_profile(id) on delete cascade |
| `starts_on` | `date` | nej |  |  |
| `ends_on` | `date` | nej |  |  |
| `note` | `text` | ja |  | check note is null or char_length(note) <= 500 |
| `created_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `constraint partner_absence_end_not_before_start check (ends_on >= starts_on)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `partner_absence_select_self` | select | alle | `exists ( select 1 from partner_profile pp where pp.id = partner_absence.partner_profile_id and pp.app_user_id = auth.uid() )` |  |
| `partner_absence_select_admin` | select | alle | `has_role('admin')` |  |

### partner_availability

Oprettet i `0018_partner_availability.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `partner_profile_id` | `uuid` | nej |  | → partner_profile(id) on delete cascade |
| `weekday` | `smallint` | nej |  | check weekday between 1 and 7 |
| `start_time` | `time` | nej |  |  |
| `end_time` | `time` | nej |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `constraint partner_availability_end_after_start check (end_time > start_time)`
- `constraint partner_availability_unique_window unique (partner_profile_id, weekday, start_time, end_time)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `partner_availability_select_self` | select | alle | `exists ( select 1 from partner_profile pp where pp.id = partner_availability.partner_profile_id and pp.app_user_id = auth.uid() )` |  |
| `partner_availability_select_admin` | select | alle | `has_role('admin')` |  |

### partner_profile

Oprettet i `0009_partner_profile.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `name` | `text` | nej |  |  |
| `title` | `text` | ja |  |  |
| `is_internal` | `boolean` | nej | `true` |  |
| `languages` | `text` | ja |  |  |
| `personal_info` | `text` | ja |  |  |
| `short_bio` | `text` | ja |  |  |
| `long_bio` | `text` | ja |  |  |
| `photo_url` | `text` | ja |  |  |
| `sort_order` | `int` | nej | `0` |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |
| `app_user_id` | `uuid` | ja |  | unik; → app_user(id) on delete set null |
| `calcom_user_id` | `integer` | ja |  | check calcom_user_id is null or calcom_user_id > 0 |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `partner_profile_select_admin` | select | alle | `has_role('admin')` |  |
| `partner_profile_select_board_owner` | select | alle | `exists ( select 1 from board_partner bp join board b on b.id = bp.board_id where bp.partner_id = partner_profile.id and b.owner_id = auth.uid() )` |  |
| `partner_profile_select_self` | select | alle | `app_user_id = auth.uid()` |  |
| `partner_profile_select_board_member` | select | alle | `exists ( select 1 from board_partner bp where bp.partner_id = partner_profile.id and is_partner_on_board(bp.board_id) )` |  |

### partner_profile_competence_tag

Oprettet i `0009_partner_profile.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `partner_profile_id` | `uuid` | nej |  | → partner_profile(id) on delete cascade |
| `competence_tag_id` | `uuid` | nej |  | → competence_tag(id) on delete cascade |

Tabelkonstraints:

- `primary key (partner_profile_id, competence_tag_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `partner_profile_competence_tag_select_admin` | select | alle | `has_role('admin')` |  |
| `partner_profile_competence_tag_select_board_owner` | select | alle | `exists ( select 1 from board_partner bp join board b on b.id = bp.board_id where bp.partner_id = partner_profile_competence_tag.partner_profile_id and b.owner_id = auth.uid() )` |  |
| `partner_profile_competence_tag_select_partner` | select | alle | `exists ( select 1 from partner_profile pp where pp.id = partner_profile_competence_tag.partner_profile_id and ( pp.app_user_id = auth.uid() or exists ( select 1 from board_partner bp where bp.partner_id = pp.id and is_partner_on_board(bp.b…` |  |

### payment_charge

Oprettet i `0013_payment.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `meeting_id` | `uuid` | ja |  | unik; → meeting(id) on delete cascade |
| `membership_id` | `uuid` | nej |  | → membership(id) on delete cascade |
| `pricing_rule_id` | `uuid` | nej |  | → pricing_rule(id) |
| `amount_minor` | `int` | nej |  | check amount_minor >= 0 |
| `currency` | `text` | nej |  |  |
| `status` | `payment_charge_status` | nej | `'afventer'` |  |
| `failure_reason` | `text` | ja |  |  |
| `provider_charge_ref` | `text` | ja |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |
| `provider_invoice_ref` | `text` | ja |  |  |
| `period_start` | `date` | ja |  |  |
| `period_end` | `date` | ja |  |  |
| `frequency_weeks` | `int` | ja |  |  |
| `partner_count` | `int` | ja |  |  |

Tabelkonstraints:

- `constraint payment_charge_period_pair check ((period_start is null) = (period_end is null))`
- `constraint payment_charge_period_order check (period_end is null or period_end > period_start)`
- `constraint payment_charge_subject check (meeting_id is not null or period_start is not null)`
- `constraint payment_charge_frequency_check check (frequency_weeks is null or frequency_weeks in (4, 8, 12))`
- `constraint payment_charge_partner_count_check check (partner_count is null or partner_count >= 1)`
- `constraint payment_charge_membership_period_unique unique (membership_id, period_start)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `payment_charge_select_owner` | select | alle | `exists ( select 1 from membership m join board b on b.id = m.board_id where m.id = payment_charge.membership_id and b.owner_id = auth.uid() )` |  |
| `payment_charge_select_admin` | select | alle | `has_role('admin')` |  |

### payment_webhook_event

Oprettet i `0013_payment.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `provider` | `text` | nej | `'alunta'` |  |
| `provider_event_id` | `text` | nej |  |  |
| `event_type` | `text` | nej |  |  |
| `provider_charge_ref` | `text` | ja |  |  |
| `received_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `unique (provider, provider_event_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `payment_webhook_event_select_admin` | select | alle | `has_role('admin')` |  |

### pricing_rule

Oprettet i `0013_payment.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `version` | `int` | nej |  | unik |
| `base_amount_minor` | `int` | nej |  | check base_amount_minor >= 0 |
| `per_partner_amount_minor` | `int` | nej |  | check per_partner_amount_minor >= 0 |
| `factor_4_weeks` | `numeric(6,4)` | nej |  | check factor_4_weeks > 0 |
| `factor_8_weeks` | `numeric(6,4)` | nej |  | check factor_8_weeks > 0 |
| `factor_12_weeks` | `numeric(6,4)` | nej |  | check factor_12_weeks > 0 |
| `currency` | `text` | nej | `'DKK'` |  |
| `is_active` | `boolean` | nej | `false` |  |
| `created_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `pricing_rule_select_active_authenticated` | select | alle | `auth.uid() is not null and is_active` |  |
| `pricing_rule_select_admin` | select | alle | `has_role('admin')` |  |

### quiz_answer

Oprettet i `0008_quiz_answer.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `owner_id` | `uuid` | nej |  | → app_user(id) on delete cascade |
| `quiz_option_id` | `uuid` | nej |  | → quiz_option(id) on delete cascade |
| `free_text` | `text` | ja |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `unique (owner_id, quiz_option_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `quiz_answer_select_owner` | select | alle | `owner_id = auth.uid()` |  |
| `quiz_answer_select_admin` | select | alle | `has_role('admin')` |  |
| `quiz_answer_insert_owner` | insert | alle |  | `owner_id = auth.uid() and exists ( select 1 from quiz_option o join quiz_question q on q.id = o.quiz_question_id where o.id = quiz_answer.quiz_option_id and q.is_published )` |
| `quiz_answer_delete_owner` | delete | alle | `owner_id = auth.uid()` |  |

### quiz_option

Oprettet i `0007_quiz.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `quiz_question_id` | `uuid` | nej |  | → quiz_question(id) on delete cascade |
| `label` | `text` | nej |  |  |
| `kind` | `quiz_option_kind` | nej |  |  |
| `frequency_weeks` | `int` | ja |  |  |
| `sort_order` | `int` | nej | `0` |  |
| `created_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `constraint quiz_option_frequency_only check (frequency_weeks is null or kind = 'frequency')`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `quiz_option_select_admin` | select | alle | `has_role('admin')` |  |
| `quiz_option_select_published` | select | alle | `auth.uid() is not null and exists ( select 1 from quiz_question q where q.id = quiz_option.quiz_question_id and q.is_published )` |  |

### quiz_option_competence_tag

Oprettet i `0007_quiz.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `quiz_option_id` | `uuid` | nej |  | → quiz_option(id) on delete cascade |
| `competence_tag_id` | `uuid` | nej |  | → competence_tag(id) on delete cascade |

Tabelkonstraints:

- `primary key (quiz_option_id, competence_tag_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `quiz_option_competence_tag_select_admin` | select | alle | `has_role('admin')` |  |
| `quiz_option_competence_tag_select_published` | select | alle | `auth.uid() is not null and exists ( select 1 from quiz_option o join quiz_question q on q.id = o.quiz_question_id where o.id = quiz_option_competence_tag.quiz_option_id and q.is_published )` |  |

### quiz_question

Oprettet i `0007_quiz.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `key` | `text` | nej |  | unik |
| `prompt` | `text` | nej |  |  |
| `kind` | `quiz_question_kind` | nej |  |  |
| `sort_order` | `int` | nej | `0` |  |
| `is_published` | `boolean` | nej | `false` |  |
| `created_at` | `timestamptz` | nej | `now()` |  |
| `updated_at` | `timestamptz` | nej | `now()` |  |

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `quiz_question_select_admin` | select | alle | `has_role('admin')` |  |
| `quiz_question_select_published` | select | alle | `is_published and auth.uid() is not null` |  |

### rating_link

Oprettet i `0023_rating_link.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `id` | `uuid` | nej | `gen_random_uuid()` | primær nøgle |
| `meeting_id` | `uuid` | nej |  | → meeting(id) on delete cascade |
| `rater_user_id` | `uuid` | ja |  | → app_user(id) on delete cascade |
| `rater_partner_profile_id` | `uuid` | ja |  | → partner_profile(id) on delete cascade |
| `expires_at` | `timestamptz` | nej |  |  |
| `used_at` | `timestamptz` | ja |  |  |
| `created_at` | `timestamptz` | nej | `now()` |  |

Tabelkonstraints:

- `constraint rating_link_one_rater check (num_nonnulls(rater_user_id, rater_partner_profile_id) = 1)`
- `constraint rating_link_unique_per_rater unique nulls not distinct (meeting_id, rater_user_id, rater_partner_profile_id)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `rating_link_select_admin` | select | alle | `has_role('admin')` |  |

### user_role_assignment

Oprettet i `0001_roles.sql`. RLS: slået til.

| Kolonne | Type | Null | Default | Bemærkning |
|---|---|---|---|---|
| `user_id` | `uuid` | nej |  | → app_user(id) on delete cascade |
| `role` | `user_role` | nej |  |  |

Tabelkonstraints:

- `primary key (user_id, role)`

| Policy | Kommando | Roller | Using | With check |
|---|---|---|---|---|
| `user_role_assignment_select_self` | select | alle | `user_id = auth.uid()` |  |

## Views

| View | Security invoker | Oprettet i |
|---|---|---|
| `partner_fee_line` | ja | 0017_partner_fee.sql |

## Enum-typer

| Type | Værdier | Oprettet i |
|---|---|---|
| `agenda_item_kind` | `dagsorden`, `spoergsmaal`, `materiale` | 0015_preparation_and_rating.sql |
| `fee_absence_rule` | `ikke_fastlagt`, `intet_honorar`, `fuldt_honorar` | 0017_partner_fee.sql |
| `fee_vat_mode` | `ikke_fastlagt`, `ekskl_moms`, `inkl_moms` | 0017_partner_fee.sql |
| `meeting_registered_status` | `afholdt`, `forsinket_afbud`, `udeblivelse` | 0012_meeting.sql |
| `meeting_status` | `planlagt`, `aflyst`, `afholdt` | 0012_meeting.sql |
| `meeting_summary_status` | `afventer`, `genereres`, `klar`, `fejlet`, `mangler_samtykke`, `mangler_optagelse` | 0022_meeting_summary.sql |
| `membership_card_status` | `mangler`, `registreret` | 0013_payment.sql |
| `membership_status` | `aktiv`, `opsagt` | 0013_payment.sql |
| `notification_channel` | `email`, `sms` | 0021_notification_template.sql |
| `notification_delivery_status` | `afventer`, `sendt`, `fejlet`, `stub`, `demo` | 0021_notification_template.sql |
| `notification_template_status` | `udkast`, `live`, `arkiveret` | 0021_notification_template.sql |
| `payment_charge_status` | `afventer`, `rapporteret`, `gennemfoert`, `fejlet` | 0013_payment.sql |
| `quiz_option_kind` | `tag`, `free_text`, `frequency` | 0007_quiz.sql |
| `quiz_question_kind` | `single`, `multi` | 0007_quiz.sql |
| `user_role` | `ejer`, `partner`, `lead_partner`, `admin` | 0001_roles.sql |

## Funktioner

| Funktion | Argumenter | Returnerer | Security definer | Oprettet i |
|---|---|---|---|---|
| `change_board_composition` | `p_board_id uuid, p_expected_partner_ids uuid[], p_add uuid[], p_remove uuid[], p_lead_id uuid, p_actor_id uuid, p_actor_role text, p_action text, p_partner_id …` | `uuid` | nej | 0026_change_board_composition.sql |
| `has_role` | `check_role user_role` | `boolean` | ja | 0005_competence_tags.sql |
| `is_partner_on_board` | `check_board_id uuid` | `boolean` | ja | 0011_partner_login.sql |
| `notification_template_guard` |  | `trigger` | nej | 0021_notification_template.sql |
| `publish_notification_template` | `p_template_id uuid, p_published_by uuid` | `void` | nej | 0021_notification_template.sql |
| `redeem_rating_link` | `p_link_id uuid, p_score smallint, p_comment text` | `uuid` | nej | 0023_rating_link.sql |

## Triggere

| Trigger | Tabel | Hvornår | Oprettet i |
|---|---|---|---|
| `notification_template_guard` | `notification_template` | before update or delete | 0021_notification_template.sql |

## Ikke udledt

Alle `create table`/`alter table`/`create policy`-sætninger blev genkendt.
