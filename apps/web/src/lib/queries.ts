import type {
  AuditResponse,
  BorrowerView,
  DashboardView,
  LoanDetailView,
  LoanSummaryView,
  SessionUser,
} from "@app/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const keys = {
  dashboard: ["dashboard"] as const,
  borrowers: (q: string) => ["borrowers", q] as const,
  borrower: (id: string) => ["borrower", id] as const,
  loans: (filter: object) => ["loans", filter] as const,
  loan: (id: string) => ["loan", id] as const,
  audit: ["audit"] as const,
  users: ["users"] as const,
  portalLoans: ["portal-loans"] as const,
};

export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => api<DashboardView>("/dashboard") });

export const useBorrowers = (q: string) =>
  useQuery({
    queryKey: keys.borrowers(q),
    queryFn: () => api<{ borrowers: BorrowerView[] }>(`/borrowers?q=${encodeURIComponent(q)}&limit=100`),
    select: (data) => data.borrowers,
    placeholderData: (previous) => previous,
  });

export const useBorrower = (id: string) =>
  useQuery({
    queryKey: keys.borrower(id),
    queryFn: () => api<{ borrower: BorrowerView }>(`/borrowers/${id}`),
    select: (data) => data.borrower,
  });

export interface LoanFilter {
  status?: string;
  borrowerId?: string;
  overdue?: boolean;
}

export const useLoans = (filter: LoanFilter) =>
  useQuery({
    queryKey: keys.loans(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter.status) params.set("status", filter.status);
      if (filter.borrowerId) params.set("borrowerId", filter.borrowerId);
      if (filter.overdue) params.set("overdue", "true");
      const query = params.toString();
      return api<{ loans: LoanSummaryView[] }>(`/loans${query ? `?${query}` : ""}`);
    },
    select: (data) => data.loans,
  });

export const useLoan = (id: string) =>
  useQuery({
    queryKey: keys.loan(id),
    queryFn: () => api<{ loan: LoanDetailView }>(`/loans/${id}`),
    select: (data) => data.loan,
  });

export const useAudit = () =>
  useQuery({ queryKey: keys.audit, queryFn: () => api<AuditResponse>("/audit") });

export const useUsers = () =>
  useQuery({
    queryKey: keys.users,
    queryFn: () => api<{ users: SessionUser[] }>("/users"),
    select: (data) => data.users,
  });
