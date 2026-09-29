export function detectPushSupport(environment: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notifications: boolean;
}): 'supported' | 'install-required' | 'unsupported' {
  const ios = /iPhone|iPad|iPod/.test(environment.userAgent) || (/Macintosh/.test(environment.userAgent) && environment.maxTouchPoints > 1);
  if (ios && !environment.standalone) return 'install-required';
  return environment.serviceWorker && environment.pushManager && environment.notifications ? 'supported' : 'unsupported';
}
