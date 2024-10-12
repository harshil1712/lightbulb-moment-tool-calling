import * as crypto from 'node:crypto';
import qs from 'qs';

interface TokenResponse {
	result?: {
		access_token: string;
		expire_time: number;
		refresh_token: string;
		uid: string;
	};
	success: boolean;
	t: Date;
	tid: string;
	code?: number;
	msg?: string;
}

interface ApiResponse {
	result?: boolean;
	code?: number;
	msg?: string;
	success: boolean;
	t: number;
	tid: string;
}

interface Creds { accessKey: string, baseUrl: string, secretKey: string }

interface DeviceStatusResponse {
	result:
	{
		code: string,
		value: string | number | boolean
	}[],
	success: boolean,
	t: number,
	tid: string
}

async function encryptStr(str: string, secret: string): Promise<string> {
	return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
}

async function getToken(creds: Creds): Promise<string> {
	const { baseUrl, accessKey, secretKey } = creds;
	const method = 'GET';
	const timestamp = Date.now().toString();
	const signUrl = '/v1.0/token?grant_type=1';
	const contentHash = crypto.createHash('sha256').update('').digest('hex');
	const stringToSign = [method, contentHash, '', signUrl].join('\n');
	const signStr = accessKey + timestamp + stringToSign;

	const headers = {
		t: timestamp,
		sign_method: 'HMAC-SHA256',
		client_id: accessKey,
		sign: await encryptStr(signStr, secretKey),
	};
	const response = await fetch(baseUrl + '/v1.0/token?grant_type=1', { headers });
	const res = (await response.json()) as TokenResponse;
	const { success } = res;
	if (!success) {
		throw Error('Fetch failed: ' + res.msg);
	}
	return res.result?.access_token || 'NO TOKEN';
}

async function getRequestSign(
	creds: Creds,
	path: string,
	method: string,
	headers: { [k: string]: string } = {},
	query: { [k: string]: any } = {},
	body: { [k: string]: any } = {}
) {
	const { accessKey, secretKey } = creds;
	const t = Date.now().toString();
	const [uri, pathQuery] = path.split('?');
	const token = await getToken(creds);
	const queryMerged = Object.assign(query, qs.parse(pathQuery));
	const sortedQuery: { [k: string]: string } = {};
	Object.keys(queryMerged)
		.sort()
		.forEach((i) => (sortedQuery[i] = query[i]));

	const querystring = decodeURIComponent(qs.stringify(sortedQuery));
	const url = querystring ? `${uri}?${querystring}` : uri;
	const contentHash =
		method !== 'GET'
			? crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
			: crypto.createHash('sha256').update('').digest('hex');
	const stringToSign = [method, contentHash, '', url].join('\n');
	const signStr = accessKey + token + t + stringToSign;
	return {
		t,
		path: url,
		client_id: accessKey,
		sign: await encryptStr(signStr, secretKey),
		sign_method: 'HMAC-SHA256',
		access_token: token,
	};
}

async function authenticatedCall(creds: Creds, method: string, endpoint: string, query?: { [k: string]: any }, body?: { [k: string]: any }) {
	const reqHeaders: { [k: string]: string } = await getRequestSign(creds, endpoint, method, {}, query, body);
	const options: RequestInit = {
		method,
		headers: reqHeaders,
	};
	if (method === 'POST' && body) {
		options.body = JSON.stringify(body);
	}
	const { baseUrl } = creds;
	try {
		const response = await fetch(baseUrl + endpoint, options);
		if (!response.ok) {
			throw new Error(`HTTP Error. Status ${response.status}`);
		}
		const result = (await response.json()) as ApiResponse;
		if (!result.success) {
			throw new Error(`Error message: ${result.msg}. Error code: ${result.code}`);
		}
		return result;
	} catch (error) {
		console.log(error);
		throw new Error(`${error}`);
	}
}

async function getDeviceStatus(creds: Creds, deviceId: string) {
	const endpoint = `/v1.0/devices/${deviceId}/status`;
	const method = 'GET';
	const { result } = await authenticatedCall(creds, method, endpoint) as unknown as DeviceStatusResponse;
	// Extract the switch, brightness, temperatuer, and color

	let status = {};
	result.forEach((c) => {
		if (c.code === 'switch_led') {
			Object.assign(status, { onOff: c.value })
		} else if (c.code === 'bright_value_v2') {
			Object.assign(status, { brightness: c.value })
		} else if (c.code === 'temp_value_v2') {
			Object.assign(status, { temp: c.value })
		} else if (c.code === 'colour_data_v2') {
			Object.assign(status, { color: JSON.parse(c.value as string) })
		}
	})

	return status
}

async function turnOnOff(creds: Creds, args: { deviceId: string, onOff: boolean }) {
	const method = 'POST';
	const { deviceId, onOff } = args;
	const endpoint = `/v1.0/devices/${deviceId}/commands`;

	const commands = [{ code: 'switch_led', value: onOff }];
	const body = {
		commands: JSON.stringify(commands),
	};
	const result = await authenticatedCall(creds, method, endpoint, {}, body);
	console.log(result);
	return Promise.resolve(JSON.stringify({
		message: `The light is now ` + (args.onOff ? 'on' : 'off'),
		deviceId: args.deviceId,
		currentState: args.onOff
	}));
}

async function getDeviceId(args: { roomName: string }, env: Env) {
	const devices = {
		bedroom: env.BEDROOM_DEVICE_ID,
		livingroom: env.LIVINGROOM_DEVICE_ID,
		diningroom: env.DINNING_DEVICE_ID,
		kitchen: env.KITCHEN_DEVICE_ID
	} as any;
	const { roomName } = args;

	return Promise.resolve(JSON.stringify(devices[roomName]));
}

async function changeColor(creds: Creds, args: { deviceId: string, h: number, s: number, v: number }) {
	const method = 'POST';
	const { deviceId, h, s, v } = args;
	const endpoint = `/v1.0/devices/${deviceId}/commands`;
	const commands = [{
		code: 'colour_data_v2', value: JSON.stringify({
			h,
			s,
			v
		})
	}]
	const body = {
		commands: JSON.stringify(commands)
	}
	const { result } = await authenticatedCall(creds, method, endpoint, {}, body)
	return Promise.resolve(JSON.stringify({
		message: 'The color has changed',
		deviceId: args.deviceId,
		currentState: `h: ${args.h}, s: ${args.s}, v: ${args.v}`
	}));
}

export { turnOnOff, getDeviceStatus, authenticatedCall, getDeviceId, changeColor };
