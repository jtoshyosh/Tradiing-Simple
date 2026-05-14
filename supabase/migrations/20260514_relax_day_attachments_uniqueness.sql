alter table public.day_attachments
  drop constraint if exists day_attachments_user_id_attachment_date_key;

create unique index if not exists day_attachments_user_date_file_path_unique
  on public.day_attachments(user_id, attachment_date, file_path);
