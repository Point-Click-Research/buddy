// One mark per kind of ask, for the suggestion cards and the job templates.

import { CalendarCheck, Mail, MessageSquare, Package, Phone, Search, type LucideIcon } from 'lucide-react';
import type { UseCaseId } from '../../shared/use-cases';

export const USE_CASE_ICONS: Record<UseCaseId, LucideIcon> = {
  discover: Search,
  purchase: Package,
  book: CalendarCheck,
  call: Phone,
  text: MessageSquare,
  email: Mail,
};
