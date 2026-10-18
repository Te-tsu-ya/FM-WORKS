CREATE TABLE `employees` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`employee_id` text,
	`name` text,
	`display_name` text,
	`department` text,
	`title` text,
	`role` text,
	`status` text,
	`work_start` text,
	`work_end` text,
	`break_minutes` text,
	`leave_balance` text,
	`email` text,
	`note` text,
	`pin_salt` text,
	`pin_hash` text,
	`must_change_pin` text,
	`failure_count` text,
	`locked_until` text,
	`last_login` text,
	`pin_updated` text,
	`auth_status` text,
	`permissions_json` text,
	`payroll_included` text,
	`manager_id` text,
	`leave_basis_date` text,
	`hire_date` text
);
--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`createdAt` text,
	`updatedAt` text,
	`ownerId` text,
	`ownerName` text,
	`vendorCode` text,
	`vendorName` text,
	`vendorAddress` text,
	`vendorInvoice` text,
	`quoteDate` text,
	`subject` text,
	`delivery` text,
	`payment` text,
	`expires` text,
	`contact` text,
	`note` text,
	`bank` text,
	`status` text,
	`number` text,
	`issuedAt` text,
	`taxRate` text,
	`subtotal` text,
	`taxAmount` text,
	`total` text,
	`revision` text,
	`requestKey` text,
	`pdfFileId` text,
	`xlsxFileId` text
);
--> statement-breakpoint
CREATE TABLE `quote_lines` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`quoteId` text,
	`position` text,
	`description` text,
	`quantity` text,
	`unit` text,
	`price` text,
	`amount` text
);
--> statement-breakpoint
CREATE TABLE `quote_sequences` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`vendorCode` text,
	`lastNumber` text,
	`verified` text,
	`updatedAt` text,
	`updatedBy` text
);
--> statement-breakpoint
CREATE TABLE `related_documents` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text,
	`field_20` text,
	`field_21` text,
	`field_22` text,
	`field_23` text,
	`field_24` text,
	`field_25` text,
	`field_26` text,
	`field_27` text,
	`field_28` text,
	`field_29` text,
	`field_30` text,
	`field_31` text,
	`field_32` text
);
--> statement-breakpoint
CREATE TABLE `document_sequences` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text
);
--> statement-breakpoint
CREATE TABLE `project_plans` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`projectId` text,
	`plannedMinutes` text,
	`ownerId` text,
	`quoteId` text,
	`orderNo` text,
	`receivedOn` text,
	`orderValue` text,
	`orderStatus` text,
	`note` text,
	`aliases` text,
	`revision` text,
	`createdAt` text,
	`updatedAt` text,
	`createdBy` text,
	`updatedBy` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`projectId` text,
	`title` text,
	`ownerId` text,
	`startDate` text,
	`dueDate` text,
	`plannedMinutes` text,
	`progress` text,
	`status` text,
	`note` text,
	`revision` text,
	`createdAt` text,
	`updatedAt` text,
	`createdBy` text,
	`updatedBy` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `project_resources` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`projectId` text,
	`title` text,
	`kind` text,
	`url` text,
	`body` text,
	`status` text,
	`revision` text,
	`createdAt` text,
	`updatedAt` text,
	`createdBy` text,
	`updatedBy` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `project_updates` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`projectId` text,
	`kind` text,
	`body` text,
	`createdAt` text,
	`createdBy` text,
	`authorName` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`code` text,
	`name` text,
	`category` text,
	`maker` text,
	`model` text,
	`location` text,
	`quantity` text,
	`minimum` text,
	`status` text,
	`note` text,
	`createdAt` text,
	`updatedAt` text,
	`updatedBy` text,
	`revision` text
);
--> statement-breakpoint
CREATE TABLE `monthly_periods` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text
);
--> statement-breakpoint
CREATE TABLE `asset_loans` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`assetId` text,
	`assetCode` text,
	`borrower` text,
	`quantity` text,
	`loanDate` text,
	`dueDate` text,
	`returnedAt` text,
	`status` text,
	`purpose` text,
	`creatorId` text,
	`createdAt` text,
	`updatedAt` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `purchase_requests` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`name` text,
	`quantity` text,
	`estimatedPrice` text,
	`neededOn` text,
	`reason` text,
	`requesterId` text,
	`requesterName` text,
	`status` text,
	`assetId` text,
	`orderedOn` text,
	`receivedOn` text,
	`note` text,
	`createdAt` text,
	`updatedAt` text,
	`requestKey` text,
	`approvedBy` text,
	`approvedAt` text
);
--> statement-breakpoint
CREATE TABLE `office_documents` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`name` text,
	`category` text,
	`location` text,
	`url` text,
	`expiresOn` text,
	`note` text,
	`status` text,
	`creatorId` text,
	`createdAt` text,
	`updatedAt` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`name` text,
	`category` text,
	`vendor` text,
	`contractNo` text,
	`startedOn` text,
	`expiresOn` text,
	`noticeOn` text,
	`renewal` text,
	`annualYen` text,
	`owner` text,
	`url` text,
	`status` text,
	`note` text,
	`createdAt` text,
	`updatedAt` text,
	`createdBy` text,
	`updatedBy` text,
	`revision` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `facilities` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`code` text,
	`name` text,
	`type` text,
	`location` text,
	`owner` text,
	`vendor` text,
	`lastCheckedOn` text,
	`nextCheckOn` text,
	`status` text,
	`note` text,
	`createdAt` text,
	`updatedAt` text,
	`createdBy` text,
	`updatedBy` text,
	`revision` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `project_worklog_links` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text
);
--> statement-breakpoint
CREATE TABLE `project_dependencies` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text
);
--> statement-breakpoint
CREATE TABLE `project_attachments` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text
);
--> statement-breakpoint
CREATE TABLE `project_read_receipts` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text
);
--> statement-breakpoint
CREATE TABLE `project_costs` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text
);
--> statement-breakpoint
CREATE TABLE `monthly_snapshots` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text,
	`field_20` text,
	`field_21` text,
	`field_22` text,
	`field_23` text,
	`field_24` text
);
--> statement-breakpoint
CREATE TABLE `project_budgets` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text
);
--> statement-breakpoint
CREATE TABLE `office_tickets` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`subject` text,
	`category` text,
	`priority` text,
	`requesterName` text,
	`assignee` text,
	`dueOn` text,
	`description` text,
	`status` text,
	`resolvedOn` text,
	`note` text,
	`createdAt` text,
	`updatedAt` text,
	`createdBy` text,
	`updatedBy` text,
	`revision` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `cashflow_years` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text
);
--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`bank` text,
	`branch` text,
	`name` text,
	`last4` text,
	`active` text,
	`revision` text,
	`updatedAt` text,
	`editorId` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `cashflow_plans` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`title` text,
	`direction` text,
	`amount` text,
	`accountId` text,
	`category` text,
	`frequency` text,
	`startMonth` text,
	`endMonth` text,
	`day` text,
	`active` text,
	`note` text,
	`revision` text,
	`updatedAt` text,
	`editorId` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`accountId` text,
	`date` text,
	`incoming` text,
	`outgoing` text,
	`description` text,
	`balance` text,
	`externalId` text,
	`occurrence` text,
	`fingerprint` text,
	`transfer` text,
	`sourceFile` text,
	`importedAt` text,
	`editorId` text,
	`revision` text
);
--> statement-breakpoint
CREATE TABLE `cashflow_periods` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`fiscalYear` text,
	`through` text,
	`revision` text,
	`updatedAt` text,
	`editorId` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `transaction_annotations` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`transactionId` text,
	`category` text,
	`tags` text,
	`note` text,
	`revision` text,
	`updatedAt` text,
	`editorId` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `classification_rules` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`keyword` text,
	`direction` text,
	`accountId` text,
	`category` text,
	`tags` text,
	`priority` text,
	`active` text,
	`revision` text,
	`updatedAt` text,
	`editorId` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `cashflow_scenarios` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`fiscalYear` text,
	`name` text,
	`changesJson` text,
	`revision` text,
	`updatedAt` text,
	`editorId` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `monthly_snapshot_days` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text,
	`field_20` text,
	`field_21` text,
	`field_22` text,
	`field_23` text,
	`field_24` text
);
--> statement-breakpoint
CREATE TABLE `bank_reconciliations` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`fiscalYear` text,
	`month` text,
	`accountId` text,
	`count` text,
	`inAmount` text,
	`outAmount` text,
	`fingerprint` text,
	`closingBalance` text,
	`note` text,
	`revision` text,
	`updatedAt` text,
	`editorId` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `plan_matches` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`name` text,
	`client` text,
	`status` text,
	`start_date` text,
	`end_date` text,
	`note` text,
	`updated_by` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `work_logs` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`date` text,
	`employee_id` text,
	`name` text,
	`project` text,
	`category` text,
	`description` text,
	`start` text,
	`end` text,
	`minutes` text,
	`note` text,
	`created_at` text,
	`status` text,
	`voided_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `attendance_logs` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`employee_id` text,
	`name` text,
	`date` text,
	`action` text,
	`timestamp` text,
	`work_location` text,
	`source` text,
	`status` text,
	`note` text,
	`voided_at` text,
	`voided_by` text
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`date` text,
	`start` text,
	`end` text,
	`all_day` text,
	`employee_ids` text,
	`employee_names` text,
	`title` text,
	`category` text,
	`location` text,
	`detail` text,
	`visibility` text,
	`status` text,
	`owner_id` text,
	`created_at` text,
	`updated_at` text,
	`source` text,
	`color_key` text
);
--> statement-breakpoint
CREATE TABLE `company_calendar` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`date` text,
	`type` text,
	`name` text,
	`work_start` text,
	`work_end` text,
	`break_minutes` text,
	`working` text,
	`source` text,
	`updated_by` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`timestamp` text,
	`employee_id` text,
	`name` text,
	`operation` text,
	`target` text,
	`target_id` text,
	`before_json` text,
	`after_json` text,
	`source` text,
	`result` text,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `monthly_reviews` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text,
	`field_20` text,
	`field_21` text,
	`field_22` text,
	`field_23` text,
	`field_24` text,
	`field_25` text,
	`field_26` text,
	`field_27` text,
	`field_28` text,
	`field_29` text,
	`field_30` text,
	`field_31` text,
	`field_32` text
);
--> statement-breakpoint
CREATE TABLE `legacy_daily_attendance` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text,
	`field_20` text,
	`field_21` text,
	`field_22` text,
	`field_23` text,
	`field_24` text,
	`field_25` text,
	`field_26` text,
	`field_27` text,
	`field_28` text,
	`field_29` text,
	`field_30` text,
	`field_31` text,
	`field_32` text
);
--> statement-breakpoint
CREATE TABLE `leave_ledger` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`key` text,
	`value` text,
	`note` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `legacy_pin_requests` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text,
	`field_20` text,
	`field_21` text,
	`field_22` text,
	`field_23` text,
	`field_24` text,
	`field_25` text,
	`field_26` text,
	`field_27` text,
	`field_28` text,
	`field_29` text,
	`field_30` text,
	`field_31` text,
	`field_32` text
);
--> statement-breakpoint
CREATE TABLE `legacy_sessions` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`field_01` text,
	`field_02` text,
	`field_03` text,
	`field_04` text,
	`field_05` text,
	`field_06` text,
	`field_07` text,
	`field_08` text,
	`field_09` text,
	`field_10` text,
	`field_11` text,
	`field_12` text,
	`field_13` text,
	`field_14` text,
	`field_15` text,
	`field_16` text,
	`field_17` text,
	`field_18` text,
	`field_19` text,
	`field_20` text,
	`field_21` text,
	`field_22` text,
	`field_23` text,
	`field_24` text,
	`field_25` text,
	`field_26` text,
	`field_27` text,
	`field_28` text,
	`field_29` text,
	`field_30` text,
	`field_31` text,
	`field_32` text
);
--> statement-breakpoint
CREATE TABLE `company_documents` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`title` text,
	`category` text,
	`summary` text,
	`effective_date` text,
	`status` text,
	`revision` text,
	`updated_at` text,
	`updated_by` text,
	`url` text,
	`created_at` text,
	`created_by` text,
	`deleted_at` text,
	`deleted_by` text,
	`request_key` text,
	`body` text,
	`folder_id` text,
	`tags` text
);
--> statement-breakpoint
CREATE TABLE `expense_receipts` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`createdAt` text,
	`creatorId` text,
	`creatorName` text,
	`usedOn` text,
	`category` text,
	`vendor` text,
	`invoiceNo` text,
	`item` text,
	`amount` text,
	`note` text,
	`payer` text,
	`paymentMethod` text,
	`paid` text,
	`receiptRef` text,
	`updatedAt` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `expense_claims` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`createdAt` text,
	`employeeId` text,
	`employeeName` text,
	`usedOn` text,
	`vendor` text,
	`item` text,
	`category` text,
	`amount` text,
	`purpose` text,
	`paymentMethod` text,
	`receiptRef` text,
	`status` text,
	`decidedBy` text,
	`decidedAt` text,
	`returnReason` text,
	`paidAt` text,
	`receivedAt` text,
	`updatedAt` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `travel_reports` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`id` text,
	`createdAt` text,
	`employeeId` text,
	`employeeName` text,
	`title` text,
	`startsOn` text,
	`startsAt` text,
	`endsOn` text,
	`endsAt` text,
	`destination` text,
	`purpose` text,
	`outcome` text,
	`distanceCategory` text,
	`spentAmount` text,
	`lodgingArea` text,
	`nights` text,
	`timeAllowance` text,
	`dailyCategory` text,
	`requestedAllowance` text,
	`note` text,
	`status` text,
	`decidedBy` text,
	`decidedAt` text,
	`returnReason` text,
	`updatedAt` text,
	`paidAt` text,
	`requestKey` text
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`row_no` integer PRIMARY KEY NOT NULL,
	`code` text,
	`name` text,
	`invoice` text,
	`address` text,
	`industry` text,
	`active` text,
	`updatedAt` text
);
--> statement-breakpoint
CREATE TABLE `site_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_guard` (
	`id` text PRIMARY KEY NOT NULL,
	`expected_revision` integer NOT NULL,
	`actual_revision` integer NOT NULL,
	CONSTRAINT "matching_revision" CHECK("transaction_guard"."expected_revision" = "transaction_guard"."actual_revision")
);
--> statement-breakpoint
CREATE TABLE `workspace_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`seed_version` text NOT NULL
);
