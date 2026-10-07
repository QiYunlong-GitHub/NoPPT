import { SetMetadata } from '@nestjs/common';

/** Routes that own a distinct authentication contract and must bypass ApiKeyGuard. */
export const PUBLIC_ROUTE_METADATA = 'noppt:public-route';
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE_METADATA, true);
