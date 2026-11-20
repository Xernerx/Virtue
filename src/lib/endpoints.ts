/** @format */

try {
	process.loadEnvFile?.('.env');
} catch {
	// Loaded via --env-file or host environment
}

export function isCanaryTarget(): boolean {
	const env = (process.env.ENVIRONMENT || process.env.NODE_ENV || 'DEVELOPMENT').trim().toUpperCase();
	return env === 'CANARY';
}

export function isProductionTarget(): boolean {
	const env = (process.env.ENVIRONMENT || process.env.NODE_ENV || 'DEVELOPMENT').trim().toUpperCase();
	return env === 'PRODUCTION' || env === 'CANARY';
}

export function getApiUrl(): string {
	const explicit = process.env.API_URL?.trim();
	if (explicit) return explicit.replace(/\/$/, '');
	if (isCanaryTarget()) return 'https://api.canary.xernerx.com';
	return isProductionTarget() ? 'https://api.xernerx.com' : 'https://api.dev.xernerx.com';
}

export function getWsUrl(): string {
	const explicit = process.env.WS_URL?.trim();
	if (explicit) return explicit.replace(/\/$/, '');
	return isProductionTarget() ? 'wss://ws.xernerx.com' : 'wss://ws.dev.xernerx.com';
}

export function getWsHealthUrl(): string {
	const explicitWs = process.env.WS_URL?.trim();
	if (explicitWs) {
		return (
			explicitWs
				.replace(/^wss:\/\//i, 'https://')
				.replace(/^ws:\/\//i, 'http://')
				.replace(/\/$/, '') + '/health'
		);
	}
	return isProductionTarget() ? 'https://ws.xernerx.com/health' : 'https://ws.dev.xernerx.com/health';
}

export function getAppUrl(): string {
	const explicit = process.env.APP_URL?.trim();
	if (explicit) return explicit.replace(/\/$/, '');
	if (isCanaryTarget()) return 'https://app.canary.xernerx.com';
	return isProductionTarget() ? 'https://app.xernerx.com' : 'https://app.dev.xernerx.com';
}
