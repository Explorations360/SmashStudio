import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// attendre l'init de l'état d'auth + du profil Firestore
async function waitReady(authSvc: AuthService) {
  while (!authSvc.ready() || (authSvc.user() && !authSvc.profileReady())) {
    await new Promise((r) => setTimeout(r, 40));
  }
}

export const authGuard: CanActivateFn = async () => {
  const authSvc = inject(AuthService);
  const router = inject(Router);
  await waitReady(authSvc);
  if (authSvc.user()) return true;
  router.navigate(['/login']);
  return false;
};

export const approvedGuard: CanActivateFn = async () => {
  const authSvc = inject(AuthService);
  const router = inject(Router);
  await waitReady(authSvc);
  if (!authSvc.user()) { router.navigate(['/login']); return false; }
  if (authSvc.isApproved()) return true;
  router.navigate(['/pending']);
  return false;
};

export const editorGuard: CanActivateFn = async () => {
  const authSvc = inject(AuthService);
  const router = inject(Router);
  await waitReady(authSvc);
  if (authSvc.canEdit()) return true;
  router.navigate(['/sounds']);
  return false;
};

export const adminGuard: CanActivateFn = async () => {
  const authSvc = inject(AuthService);
  const router = inject(Router);
  await waitReady(authSvc);
  if (authSvc.isAdmin()) return true;
  router.navigate(['/sounds']);
  return false;
};
