// BERKAS INI DIHASILKAN OTOMATIS — JANGAN DIUBAH TANGAN.
//
// Sumber: skema `public` database Supabase (project development).
// Hasilkan ulang dengan `npm run db:types`; CI memeriksa drift lewat
// `npm run db:types:check`.
//
// Tipe yang dipakai aplikasi — union peran/status klub, bentuk baris RPC, dan
// tabel audit yang hanya boleh ditulis database — ada di ./database.types.ts,
// yang menurunkan serta mempersempit tipe dari berkas ini.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "chat_messages": {
                  Row: {
                    "client_message_id": string | null,"content": string,"created_at": string,"deleted_at": string | null,"edited_at": string | null,"id": string,"message_type": string,"ride_id": string,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_message_id"?: string | null,"content": string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"message_type"?: string,"ride_id": string,"sender_id": string
                  }
                  Update: {
                    "client_message_id"?: string | null,"content"?: string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"message_type"?: string,"ride_id"?: string,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_messages_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "rides"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"club_members": {
                  Row: {
                    "club_id": string,"created_at": string,"joined_at": string | null,"role": string,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "club_id": string,"created_at"?: string,"joined_at"?: string | null,"role"?: string,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "club_id"?: string,"created_at"?: string,"joined_at"?: string | null,"role"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_members_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"club_posts": {
                  Row: {
                    "author_id": string,"club_id": string,"content": string | null,"created_at": string,"id": string,"media_path": string | null,"updated_at": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"club_id": string,"content"?: string | null,"created_at"?: string,"id"?: string,"media_path"?: string | null,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "author_id"?: string,"club_id"?: string,"content"?: string | null,"created_at"?: string,"id"?: string,"media_path"?: string | null,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_posts_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_posts_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    }
                  ]
                },"club_role_audit": {
                  Row: {
                    "action": string,"actor_id": string | null,"club_id": string,"created_at": string,"id": string,"new_role": string | null,"new_status": string | null,"old_role": string | null,"old_status": string | null,"subject_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"club_id": string,"created_at"?: string,"id"?: string,"new_role"?: string | null,"new_status"?: string | null,"old_role"?: string | null,"old_status"?: string | null,"subject_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"club_id"?: string,"created_at"?: string,"id"?: string,"new_role"?: string | null,"new_status"?: string | null,"old_role"?: string | null,"old_status"?: string | null,"subject_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "club_role_audit_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_role_audit_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "club_role_audit_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"clubs": {
                  Row: {
                    "created_at": string,"created_by": string,"description": string | null,"id": string,"join_policy": string,"logo_path": string | null,"name": string,"slug": string,"updated_at": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"join_policy"?: string,"logo_path"?: string | null,"name": string,"slug": string,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"join_policy"?: string,"logo_path"?: string | null,"name"?: string,"slug"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clubs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"content_reports": {
                  Row: {
                    "created_at": string,"details": string | null,"id": string,"reason": string,"reporter_id": string,"reviewed_at": string | null,"status": string,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"details"?: string | null,"id"?: string,"reason": string,"reporter_id": string,"reviewed_at"?: string | null,"status"?: string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "created_at"?: string,"details"?: string | null,"id"?: string,"reason"?: string,"reporter_id"?: string,"reviewed_at"?: string | null,"status"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"follows": {
                  Row: {
                    "created_at": string,"followed_id": string,"follower_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"followed_id": string,"follower_id": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"followed_id"?: string,"follower_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follows_followed_id_fkey"
      columns: ["followed_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follows_follower_id_fkey"
      columns: ["follower_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hazard_confirmations": {
                  Row: {
                    "created_at": string,"hazard_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"hazard_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"hazard_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hazard_confirmations_hazard_id_fkey"
      columns: ["hazard_id"]
isOneToOne: false
      referencedRelation: "hazard_reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hazard_confirmations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hazard_reports": {
                  Row: {
                    "category": string,"client_report_id": string | null,"created_at": string,"description": string | null,"expires_at": string,"id": string,"latitude": number,"longitude": number,"reporter_id": string,"ride_id": string | null,"severity": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"client_report_id"?: string | null,"created_at"?: string,"description"?: string | null,"expires_at": string,"id"?: string,"latitude": number,"longitude": number,"reporter_id": string,"ride_id"?: string | null,"severity"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "category"?: string,"client_report_id"?: string | null,"created_at"?: string,"description"?: string | null,"expires_at"?: string,"id"?: string,"latitude"?: number,"longitude"?: number,"reporter_id"?: string,"ride_id"?: string | null,"severity"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hazard_reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hazard_reports_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "rides"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_actions": {
                  Row: {
                    "action": string,"actor_id": string,"created_at": string,"id": string,"note": string | null,"reason": string,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"created_at"?: string,"id"?: string,"note"?: string | null,"reason": string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"created_at"?: string,"id"?: string,"note"?: string | null,"reason"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "moderation_actions_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"motorcycle_private_details": {
                  Row: {
                    "motorcycle_id": string,"owner_id": string,"plate_number": string | null,"private_notes": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "motorcycle_id": string,"owner_id": string,"plate_number"?: string | null,"private_notes"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "motorcycle_id"?: string,"owner_id"?: string,"plate_number"?: string | null,"private_notes"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "motorcycle_private_details_bike_owner_fkey"
      columns: ["motorcycle_id","owner_id"]
isOneToOne: false
      referencedRelation: "motorcycles"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "motorcycle_private_details_motorcycle_id_fkey"
      columns: ["motorcycle_id"]
isOneToOne: true
      referencedRelation: "motorcycles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "motorcycle_private_details_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"motorcycles": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_primary": boolean,"is_public": boolean,"make": string,"model": string,"model_year": number | null,"nickname": string | null,"owner_id": string,"photo_path": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_primary"?: boolean,"is_public"?: boolean,"make": string,"model": string,"model_year"?: number | null,"nickname"?: string | null,"owner_id": string,"photo_path"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_primary"?: boolean,"is_public"?: boolean,"make"?: string,"model"?: string,"model_year"?: number | null,"nickname"?: string | null,"owner_id"?: string,"photo_path"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "motorcycles_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"entity_id": string | null,"entity_type": string | null,"id": string,"kind": string,"payload": NonNullable<Json>,"read_at": string | null,"recipient_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"kind": string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"recipient_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"recipient_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"post_comments": {
                  Row: {
                    "author_id": string,"content": string,"created_at": string,"id": string,"post_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"content": string,"created_at"?: string,"id"?: string,"post_id": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"content"?: string,"created_at"?: string,"id"?: string,"post_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "post_comments_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "club_posts"
      referencedColumns: ["id"]
    }
                  ]
                },"post_reactions": {
                  Row: {
                    "created_at": string,"post_id": string,"reaction": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"post_id": string,"reaction"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"post_id"?: string,"reaction"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_reactions_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "club_posts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "post_reactions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"bio": string | null,"city": string | null,"created_at": string,"deleted_at": string | null,"display_name": string,"id": string,"is_private": boolean,"updated_at": string,"username": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"bio"?: string | null,"city"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"display_name": string,"id": string,"is_private"?: boolean,"updated_at"?: string,"username": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"bio"?: string | null,"city"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string,"id"?: string,"is_private"?: boolean,"updated_at"?: string,"username"?: string
                  }
                  Relationships: [

                  ]
                },"push_tokens": {
                  Row: {
                    "created_at": string,"device_label": string | null,"id": string,"last_seen_at": string,"platform": string,"token": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"device_label"?: string | null,"id"?: string,"last_seen_at"?: string,"platform": string,"token": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"device_label"?: string | null,"id"?: string,"last_seen_at"?: string,"platform"?: string,"token"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_tokens_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"ride_locations": {
                  Row: {
                    "accuracy_m": number | null,"heading_deg": number | null,"latitude": number,"longitude": number,"recorded_at": string,"ride_id": string,"speed_mps": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accuracy_m"?: number | null,"heading_deg"?: number | null,"latitude": number,"longitude": number,"recorded_at": string,"ride_id": string,"speed_mps"?: number | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "accuracy_m"?: number | null,"heading_deg"?: number | null,"latitude"?: number,"longitude"?: number,"recorded_at"?: string,"ride_id"?: string,"speed_mps"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ride_locations_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "rides"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ride_locations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"ride_members": {
                  Row: {
                    "created_at": string,"joined_at": string | null,"last_seen_at": string | null,"ride_id": string,"role": string,"sharing_location": boolean,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"joined_at"?: string | null,"last_seen_at"?: string | null,"ride_id": string,"role"?: string,"sharing_location"?: boolean,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"joined_at"?: string | null,"last_seen_at"?: string | null,"ride_id"?: string,"role"?: string,"sharing_location"?: boolean,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ride_members_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "rides"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ride_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"rides": {
                  Row: {
                    "activity_type": string,"club_id": string | null,"created_at": string,"created_by": string,"description": string | null,"destination_label": string | null,"destination_lat": number | null,"destination_lng": number | null,"ended_at": string | null,"id": string,"invite_code": string | null,"meeting_label": string | null,"meeting_lat": number | null,"meeting_lng": number | null,"started_at": string | null,"starts_at": string | null,"status": string,"title": string,"updated_at": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_type"?: string,"club_id"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"destination_label"?: string | null,"destination_lat"?: number | null,"destination_lng"?: number | null,"ended_at"?: string | null,"id"?: string,"invite_code"?: string | null,"meeting_label"?: string | null,"meeting_lat"?: number | null,"meeting_lng"?: number | null,"started_at"?: string | null,"starts_at"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "activity_type"?: string,"club_id"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"destination_label"?: string | null,"destination_lat"?: number | null,"destination_lng"?: number | null,"ended_at"?: string | null,"id"?: string,"invite_code"?: string | null,"meeting_label"?: string | null,"meeting_lat"?: number | null,"meeting_lng"?: number | null,"started_at"?: string | null,"starts_at"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rides_club_id_fkey"
      columns: ["club_id"]
isOneToOne: false
      referencedRelation: "clubs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rides_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_blocks": {
                  Row: {
                    "blocked_id": string,"blocker_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_id": string,"blocker_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_id"?: string,"blocker_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_blocks_blocked_id_fkey"
      columns: ["blocked_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_blocks_blocker_id_fkey"
      columns: ["blocker_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_follow_request":
{ Args: { "p_follower_id": string }; Returns: boolean
                           },
"accept_ride_invite":
{ Args: { "p_ride_id": string }; Returns: string
                           },
"can_moderate_chat_message":
{ Args: { "p_message_id": string }; Returns: boolean
                           },
"can_moderate_content_report":
{ Args: { "p_report_id": string }; Returns: boolean
                           },
"can_moderate_hazard":
{ Args: { "p_hazard_id": string }; Returns: boolean
                           },
"can_moderate_ride":
{ Args: { "p_ride_id": string }; Returns: boolean
                           },
"can_publish_ride_location":
{ Args: { "p_ride_id": string }; Returns: boolean
                           },
"confirm_hazard":
{ Args: { "p_hazard_id": string }; Returns: number
                           },
"create_club":
{ Args: { "p_description"?: string,"p_join_policy"?: string,"p_name": string,"p_slug"?: string,"p_visibility"?: string }; Returns: Json
                           },
"create_hazard":
{ Args: { "p_category": string,"p_client_report_id"?: string,"p_description"?: string,"p_latitude": number,"p_longitude": number,"p_ride_id"?: string,"p_severity": string }; Returns: {
              "category": string,
"client_report_id": string | null,
"created_at": string,
"description": string | null,
"expires_at": string,
"id": string,
"latitude": number,
"longitude": number,
"reporter_id": string,
"ride_id": string | null,
"severity": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "hazard_reports"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_ride":
{ Args: { "p_club_id": string,"p_description"?: string,"p_destination_label"?: string,"p_meeting_label"?: string,"p_starts_at"?: string,"p_title": string,"p_visibility"?: string }; Returns: {
              "activity_type": string,
"club_id": string | null,
"created_at": string,
"created_by": string,
"description": string | null,
"destination_label": string | null,
"destination_lat": number | null,
"destination_lng": number | null,
"ended_at": string | null,
"id": string,
"invite_code": string | null,
"meeting_label": string | null,
"meeting_lat": number | null,
"meeting_lng": number | null,
"started_at": string | null,
"starts_at": string | null,
"status": string,
"title": string,
"updated_at": string,
"visibility": string
            }
                          SetofOptions: {
        from: "*"
        to: "rides"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_chat_message":
{ Args: { "p_message_id": string }; Returns: {
              "client_message_id": string | null,
"content": string,
"created_at": string,
"deleted_at": string | null,
"edited_at": string | null,
"id": string,
"message_type": string,
"ride_id": string,
"sender_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "chat_messages"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"edit_chat_message":
{ Args: { "p_content": string,"p_message_id": string }; Returns: {
              "client_message_id": string | null,
"content": string,
"created_at": string,
"deleted_at": string | null,
"edited_at": string | null,
"id": string,
"message_type": string,
"ride_id": string,
"sender_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "chat_messages"
        isOneToOne: true
        isSetofReturn: false
      } },
"expire_hazard_reports":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"get_moderation_subject":
{ Args: { "p_target_id": string,"p_target_type": string }; Returns: Json
                           },
"hazard_expiry_seconds":
{ Args: { "p_category": string }; Returns: number
                           },
"insert_ride_system_message":
{ Args: { "p_actor"?: string,"p_content": string,"p_ride_id": string }; Returns: string
                           },
"invite_ride_member":
{ Args: { "p_ride_id": string,"p_user_id": string }; Returns: string
                           },
"is_blocked_by_me":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"is_club_admin":
{ Args: { "p_club_id": string }; Returns: boolean
                           },
"is_club_member":
{ Args: { "p_club_id": string }; Returns: boolean
                           },
"is_ride_active_member":
{ Args: { "p_ride_id": string }; Returns: boolean
                           },
"is_ride_host":
{ Args: { "p_ride_id": string }; Returns: boolean
                           },
"is_ride_member":
{ Args: { "p_ride_id": string }; Returns: boolean
                           },
"join_ride":
{ Args: { "p_ride_id": string }; Returns: string
                           },
"leave_club":
{ Args: { "p_club_id": string }; Returns: string
                           },
"leave_ride":
{ Args: { "p_ride_id": string }; Returns: string
                           },
"list_moderation_actions":
{ Args: { "p_limit"?: number,"p_target_id"?: string,"p_target_type"?: string }; Returns: {
              "action": string,
"actor_id": string,
"created_at": string,
"id": string,
"note": string | null,
"reason": string,
"target_id": string,
"target_type": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "moderation_actions"
        isOneToOne: false
        isSetofReturn: true
      } },
"moderate_chat_message":
{ Args: { "p_message_id": string,"p_note"?: string,"p_reason": string }; Returns: {
              "client_message_id": string | null,
"content": string,
"created_at": string,
"deleted_at": string | null,
"edited_at": string | null,
"id": string,
"message_type": string,
"ride_id": string,
"sender_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "chat_messages"
        isOneToOne: true
        isSetofReturn: false
      } },
"moderate_hazard":
{ Args: { "p_action": string,"p_hazard_id": string,"p_note"?: string,"p_reason": string }; Returns: {
              "category": string,
"client_report_id": string | null,
"created_at": string,
"description": string | null,
"expires_at": string,
"id": string,
"latitude": number,
"longitude": number,
"reporter_id": string,
"ride_id": string | null,
"severity": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "hazard_reports"
        isOneToOne: true
        isSetofReturn: false
      } },
"publish_ride_location":
{ Args: { "p_accuracy_m"?: number,"p_heading_deg"?: number,"p_latitude": number,"p_longitude": number,"p_recorded_at"?: string,"p_ride_id": string,"p_speed_mps"?: number }; Returns: {
              "accuracy_m": number | null,
"heading_deg": number | null,
"latitude": number,
"longitude": number,
"recorded_at": string,
"ride_id": string,
"speed_mps": number | null,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "ride_locations"
        isOneToOne: true
        isSetofReturn: false
      } },
"remove_club_member":
{ Args: { "p_club_id": string,"p_user_id": string }; Returns: string
                           },
"remove_hazard":
{ Args: { "p_hazard_id": string }; Returns: {
              "category": string,
"client_report_id": string | null,
"created_at": string,
"description": string | null,
"expires_at": string,
"id": string,
"latitude": number,
"longitude": number,
"reporter_id": string,
"ride_id": string | null,
"severity": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "hazard_reports"
        isOneToOne: true
        isSetofReturn: false
      } },
"remove_ride_member":
{ Args: { "p_ride_id": string,"p_user_id": string }; Returns: string
                           },
"report_content":
{ Args: { "p_details"?: string,"p_reason": string,"p_target_id": string,"p_target_type": string }; Returns: {
              "created_at": string,
"details": string | null,
"id": string,
"reason": string,
"reporter_id": string,
"reviewed_at": string | null,
"status": string,
"target_id": string,
"target_type": string
            }
                          SetofOptions: {
        from: "*"
        to: "content_reports"
        isOneToOne: true
        isSetofReturn: false
      } },
"request_club_membership":
{ Args: { "p_club_id": string }; Returns: string
                           },
"review_club_membership":
{ Args: { "p_approve": boolean,"p_club_id": string,"p_user_id": string }; Returns: string
                           },
"review_content_report":
{ Args: { "p_note"?: string,"p_report_id": string,"p_status": string }; Returns: {
              "created_at": string,
"details": string | null,
"id": string,
"reason": string,
"reporter_id": string,
"reviewed_at": string | null,
"status": string,
"target_id": string,
"target_type": string
            }
                          SetofOptions: {
        from: "*"
        to: "content_reports"
        isOneToOne: true
        isSetofReturn: false
      } },
"send_chat_message":
{ Args: { "p_client_message_id"?: string,"p_content": string,"p_ride_id": string }; Returns: {
              "client_message_id": string | null,
"content": string,
"created_at": string,
"deleted_at": string | null,
"edited_at": string | null,
"id": string,
"message_type": string,
"ride_id": string,
"sender_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "chat_messages"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_club_member_role":
{ Args: { "p_club_id": string,"p_role": string,"p_user_id": string }; Returns: string
                           },
"set_ride_location_sharing":
{ Args: { "p_enabled": boolean,"p_ride_id": string }; Returns: boolean
                           },
"transition_ride":
{ Args: { "p_next": string,"p_ride_id": string }; Returns: {
              "activity_type": string,
"club_id": string | null,
"created_at": string,
"created_by": string,
"description": string | null,
"destination_label": string | null,
"destination_lat": number | null,
"destination_lng": number | null,
"ended_at": string | null,
"id": string,
"invite_code": string | null,
"meeting_label": string | null,
"meeting_lat": number | null,
"meeting_lng": number | null,
"started_at": string | null,
"starts_at": string | null,
"status": string,
"title": string,
"updated_at": string,
"visibility": string
            }
                          SetofOptions: {
        from: "*"
        to: "rides"
        isOneToOne: true
        isSetofReturn: false
      } },
"update_hazard":
{ Args: { "p_description"?: string,"p_hazard_id": string,"p_severity": string }; Returns: {
              "category": string,
"client_report_id": string | null,
"created_at": string,
"description": string | null,
"expires_at": string,
"id": string,
"latitude": number,
"longitude": number,
"reporter_id": string,
"ride_id": string | null,
"severity": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "hazard_reports"
        isOneToOne: true
        isSetofReturn: false
      } },
"update_ride":
{ Args: { "p_description"?: string,"p_destination_label"?: string,"p_meeting_label"?: string,"p_ride_id": string,"p_starts_at"?: string,"p_title": string }; Returns: {
              "activity_type": string,
"club_id": string | null,
"created_at": string,
"created_by": string,
"description": string | null,
"destination_label": string | null,
"destination_lat": number | null,
"destination_lng": number | null,
"ended_at": string | null,
"id": string,
"invite_code": string | null,
"meeting_label": string | null,
"meeting_lat": number | null,
"meeting_lng": number | null,
"started_at": string | null,
"starts_at": string | null,
"status": string,
"title": string,
"updated_at": string,
"visibility": string
            }
                          SetofOptions: {
        from: "*"
        to: "rides"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {

          }
        }
} as const
