/** @format */

const factors = {
	easy: { a: 1, b: 20 },
	casual: { a: 3, b: 40 },
	balanced: { a: 5, b: 50 },
	hard: { a: 8, b: 60 },
	extreme: { a: 12, b: 100 },
};

const ranges = {
	easy: { min: 15, max: 25 },
	casual: { min: 10, max: 18 },
	balanced: { min: 7, max: 13 },
	hard: { min: 5, max: 10 },
	extreme: { min: 3, max: 7 },
};

export function calculateLevel(factor: keyof typeof factors, level: number) {
	const { a, b } = factors[factor];
	return a * (level + 1) * (level + 1) + b * (level + 1);
}

export function calculateExperience(range: keyof typeof ranges) {
	const { min, max } = ranges[range];
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
