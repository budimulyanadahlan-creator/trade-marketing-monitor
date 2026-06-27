export type UserRole = "user" | "manager" | "finance" | "admin" | "superadmin" | "distributor";

export type CampaignStatus =
  | "draft"
  | "submitted"
  | "approved_l1"
  | "approved_l2"
  | "approved_l3"
  | "approved_l4"
  | "approved"
  | "rejected"
  | "ongoing"
  | "claim_submitted"
  | "paid"
  | "completed"
  | "cancelled";

export type PromotionType = "TP" | "CP";

// -------------------------------------------------------
// Row shapes (match database columns exactly — no joins)
// -------------------------------------------------------

export type DepartmentRow = {
  id: string;
  name: string;
};

export type UserRow = {
  id: string;
  full_name: string;
  department_id: string | null;
  region_id: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BrandRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
};

export type RegionRow = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export type ChannelRow = {
  id: string;
  name: string;
  is_active: boolean;
};

export type PromotionCategoryRow = {
  id: string;
  name: string;
  type: PromotionType;
  account_code: string;
  is_active: boolean;
  created_at: string;
};

export type VendorRow = {
  id: string;
  name: string;
  contact: string | null;
  service_category: string | null;
  is_active: boolean;
  created_at: string;
};

export type MasterBudgetRow = {
  id: string;
  promotion_category_id: string;
  fiscal_year: number;
  quarter: number;
  total_amount: number;
  created_by: string | null;
  created_at: string;
};

export type BudgetAllocationRow = {
  id: string;
  master_budget_id: string;
  brand_id: string;
  allocated_amount: number;
  fiscal_year: number;
  created_at: string;
};

export type ActionApprovalRow = {
  id: string;
  name: string;
  master_budget_id: string | null;
  brand_id: string | null;
  start_date: string;
  end_date: string;
  target_budget: number;
  created_by: string | null;
  created_at: string;
};

export type ApprovalLevelRow = {
  id: string;
  name: string;
  sequence: number;
  is_active: boolean;
  created_at: string;
};

export type ApproverAssignmentRow = {
  id: string;
  level_id: string;
  user_id: string;
  is_active: boolean;
  created_at: string;
};

export type SkpNumberCounterRow = {
  year: number;
  month: number;
  last_sequence: number;
};

export type CampaignRow = {
  id: string;
  action_approval_id: string | null;
  name: string;
  department_id: string;
  brand_id: string;
  region_id: string;
  channel_id: string | null;
  promotion_category_id: string | null;
  vendor_id: string | null;
  store_id: string | null;
  objective: string | null;
  mechanism: string;
  avg_sales_3months: number;
  sales_projection: number;
  requested_budget: number;
  actual_spent: number;
  status: CampaignStatus;
  created_by: string;
  start_date: string | null;
  end_date: string | null;
  submitted_at: string | null;
  skp_number: string | null;
  aa_reference_number: string | null;
  updated_at: string;
  created_at: string;
};

export type CampaignFileRow = {
  id: string;
  campaign_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  uploaded_at: string;
};

export type ApprovalAction = "submitted" | "approved_l1" | "approved_l2" | "approved_l3" | "approved_l4" | "approved" | "rejected";

export type ApprovalHistoryRow = {
  id: string;
  campaign_id: string;
  actor_id: string;
  role: UserRole;
  action: ApprovalAction;
  signature_text: string | null;
  signature_image: string | null;
  comment: string | null;
  created_at: string;
};

export type RealizationRow = {
  id: string;
  campaign_id: string;
  invoice_number: string;
  amount: number;
  realization_date: string;
  created_by: string | null;
  created_at: string;
};

export type DistributorReceiptRow = {
  id: string;
  campaign_id: string;
  received_by: string;
  received_at: string;
  notes: string | null;
  created_at: string;
};

export type ClaimDocumentTypeRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type ClaimRequirementRow = {
  id: string;
  promotion_category_id: string;
  document_type_id: string;
  created_at: string;
};

export type DistributorClaimChecklistRow = {
  id: string;
  campaign_id: string;
  distributor_id: string;
  document_type_id: string;
  is_fulfilled: boolean;
  updated_at: string;
};

// Convenience aliases
export type Department = DepartmentRow;
export type UserProfile = UserRow;

// -------------------------------------------------------
// Supabase Database generic
// -------------------------------------------------------
export type Database = {
  public: {
    Tables: {
      departments: {
        Row: DepartmentRow;
        Insert: Omit<DepartmentRow, "id"> & { id?: string };
        Update: Partial<DepartmentRow>;
        Relationships: [];
      };
      users: {
        Row: UserRow;
        Insert: {
          id: string;
          full_name: string;
          department_id?: string | null;
          region_id?: string | null;
          role?: UserRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          department_id?: string | null;
          region_id?: string | null;
          role?: UserRole;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          }
        ];
      };
      brands: {
        Row: BrandRow;
        Insert: { id?: string; name: string; code: string; is_active?: boolean; created_at?: string };
        Update: Partial<Omit<BrandRow, "id" | "created_at">>;
        Relationships: [];
      };
      regions: {
        Row: RegionRow;
        Insert: { id?: string; name: string; is_active?: boolean; created_at?: string };
        Update: Partial<Omit<RegionRow, "id" | "created_at">>;
        Relationships: [];
      };
      channels: {
        Row: ChannelRow;
        Insert: { id?: string; name: string; is_active?: boolean };
        Update: Partial<Omit<ChannelRow, "id">>;
        Relationships: [];
      };
      promotion_categories: {
        Row: PromotionCategoryRow;
        Insert: { id?: string; name: string; type: PromotionType; account_code: string; is_active?: boolean; created_at?: string };
        Update: Partial<Omit<PromotionCategoryRow, "id" | "created_at">>;
        Relationships: [];
      };
      vendors: {
        Row: VendorRow;
        Insert: { id?: string; name: string; contact?: string | null; service_category?: string | null; is_active?: boolean; created_at?: string };
        Update: Partial<Omit<VendorRow, "id" | "created_at">>;
        Relationships: [];
      };
      master_budgets: {
        Row: MasterBudgetRow;
        Insert: Omit<MasterBudgetRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<Omit<MasterBudgetRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "master_budgets_promotion_category_id_fkey";
            columns: ["promotion_category_id"];
            isOneToOne: false;
            referencedRelation: "promotion_categories";
            referencedColumns: ["id"];
          }
        ];
      };
      budget_allocations: {
        Row: BudgetAllocationRow;
        Insert: Omit<BudgetAllocationRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<Omit<BudgetAllocationRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "budget_allocations_master_budget_id_fkey";
            columns: ["master_budget_id"];
            isOneToOne: false;
            referencedRelation: "master_budgets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budget_allocations_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      action_approvals: {
        Row: ActionApprovalRow;
        Insert: Omit<ActionApprovalRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<Omit<ActionApprovalRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "programs_master_budget_id_fkey";
            columns: ["master_budget_id"];
            isOneToOne: false;
            referencedRelation: "master_budgets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "programs_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          }
        ];
      };
      campaigns: {
        Row: CampaignRow;
        Insert: Omit<CampaignRow, "id" | "created_at" | "updated_at" | "actual_spent" | "submitted_at" | "skp_number" | "aa_reference_number"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          actual_spent?: number;
          submitted_at?: string | null;
          skp_number?: string | null;
          aa_reference_number?: string | null;
          mechanism?: string;
          sales_projection?: number;
        };
        Update: Partial<Omit<CampaignRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "campaigns_action_approval_id_fkey";
            columns: ["action_approval_id"];
            isOneToOne: false;
            referencedRelation: "action_approvals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_region_id_fkey";
            columns: ["region_id"];
            isOneToOne: false;
            referencedRelation: "regions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_promotion_category_id_fkey";
            columns: ["promotion_category_id"];
            isOneToOne: false;
            referencedRelation: "promotion_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      campaign_files: {
        Row: CampaignFileRow;
        Insert: Omit<CampaignFileRow, "id" | "uploaded_at"> & { id?: string; uploaded_at?: string };
        Update: Partial<Omit<CampaignFileRow, "id" | "uploaded_at">>;
        Relationships: [
          {
            foreignKeyName: "campaign_files_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          }
        ];
      };
      approval_history: {
        Row: ApprovalHistoryRow;
        Insert: Omit<ApprovalHistoryRow, "id" | "created_at" | "signature_text" | "signature_image"> & { id?: string; created_at?: string; signature_text?: string | null; signature_image?: string | null };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "approval_history_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_history_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      realizations: {
        Row: RealizationRow;
        Insert: Omit<RealizationRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<Omit<RealizationRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "realizations_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          }
        ];
      };
      distributor_receipts: {
        Row: DistributorReceiptRow;
        Insert: Omit<DistributorReceiptRow, "id" | "created_at" | "received_at"> & {
          id?: string;
          received_at?: string;
          created_at?: string;
        };
        Update: Partial<Omit<DistributorReceiptRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "distributor_receipts_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "distributor_receipts_received_by_fkey";
            columns: ["received_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      approval_levels: {
        Row: ApprovalLevelRow;
        Insert: { id?: string; name: string; sequence: number; is_active?: boolean; created_at?: string };
        Update: Partial<Omit<ApprovalLevelRow, "id" | "created_at">>;
        Relationships: [];
      };
      approver_assignments: {
        Row: ApproverAssignmentRow;
        Insert: { id?: string; level_id: string; user_id: string; is_active?: boolean; created_at?: string };
        Update: Partial<Omit<ApproverAssignmentRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "approver_assignments_level_id_fkey";
            columns: ["level_id"];
            isOneToOne: false;
            referencedRelation: "approval_levels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approver_assignments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      skp_number_counters: {
        Row: SkpNumberCounterRow;
        Insert: { year: number; month: number; last_sequence?: number };
        Update: { last_sequence?: number };
        Relationships: [];
      };
      claim_document_types: {
        Row: ClaimDocumentTypeRow;
        Insert: { id?: string; name: string; sort_order: number; created_at?: string };
        Update: Partial<Omit<ClaimDocumentTypeRow, "id" | "created_at">>;
        Relationships: [];
      };
      claim_requirements: {
        Row: ClaimRequirementRow;
        Insert: { id?: string; promotion_category_id: string; document_type_id: string; created_at?: string };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "claim_requirements_promotion_category_id_fkey";
            columns: ["promotion_category_id"];
            isOneToOne: false;
            referencedRelation: "promotion_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claim_requirements_document_type_id_fkey";
            columns: ["document_type_id"];
            isOneToOne: false;
            referencedRelation: "claim_document_types";
            referencedColumns: ["id"];
          }
        ];
      };
      distributor_claim_checklists: {
        Row: DistributorClaimChecklistRow;
        Insert: {
          id?: string;
          campaign_id: string;
          distributor_id: string;
          document_type_id: string;
          is_fulfilled?: boolean;
          updated_at?: string;
        };
        Update: { is_fulfilled?: boolean; updated_at?: string };
        Relationships: [
          {
            foreignKeyName: "distributor_claim_checklists_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "distributor_claim_checklists_distributor_id_fkey";
            columns: ["distributor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "distributor_claim_checklists_document_type_id_fkey";
            columns: ["document_type_id"];
            isOneToOne: false;
            referencedRelation: "claim_document_types";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_skp_counter: {
        Args: { p_year: number; p_month: number };
        Returns: number;
      };
    };
    Enums: {
      user_role: UserRole;
      promotion_type: PromotionType;
      campaign_status: CampaignStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
