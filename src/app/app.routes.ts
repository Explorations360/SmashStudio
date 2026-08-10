import { Routes } from '@angular/router';
import { adminGuard, approvedGuard, authGuard, editorGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent) },
  { path: 'pending', loadComponent: () => import('./pages/pending/pending.component').then((m) => m.PendingComponent), canActivate: [authGuard] },
  {
    path: '',
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    canActivate: [authGuard, approvedGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'sounds' },
      { path: 'sounds', loadComponent: () => import('./pages/sounds/sounds.component').then((m) => m.SoundsComponent) },
      { path: 'sounds/new', loadComponent: () => import('./pages/sound-edit/sound-edit.component').then((m) => m.SoundEditComponent), canActivate: [editorGuard] },
      { path: 'sounds/:id', loadComponent: () => import('./pages/sound-edit/sound-edit.component').then((m) => m.SoundEditComponent), canActivate: [editorGuard] },
      { path: 'import', loadComponent: () => import('./pages/import/import.component').then((m) => m.ImportComponent), canActivate: [editorGuard] },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent), canActivate: [editorGuard] },
      { path: 'accounts', loadComponent: () => import('./pages/accounts/accounts.component').then((m) => m.AccountsComponent), canActivate: [adminGuard] },
    ],
  },
  { path: '**', redirectTo: '' },
];
