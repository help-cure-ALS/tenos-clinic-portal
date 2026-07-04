import { Badge } from '@mantine/core';
import { useTranslation } from 'react-i18next';

type Status = 'pending' | 'approved' | 'rejected' | 'valid' | 'revoked' | 'expired' | 'active' | 'inactive';

const STATUS_COLORS: Record<Status, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  valid: 'green',
  revoked: 'red',
  expired: 'gray',
  active: 'green',
  inactive: 'gray',
};

interface StatusBadgeProps {
  status: Status;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={STATUS_COLORS[status] || 'gray'}>
      {t(`common.${status}`, status)}
    </Badge>
  );
}
