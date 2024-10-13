import { generateText, tool } from 'ai';
import { z } from 'zod';
import { createOpenAI } from "@ai-sdk/openai"

import { Hono } from 'hono';
import { getDeviceStatus, turnOnOff, getDeviceId, changeColor } from '../utils/tuya';
import { bearerAuth } from 'hono/bearer-auth';
import { logger } from 'hono/logger';
import { contextStorage, getContext } from 'hono/context-storage';

const app = new Hono<{ Bindings: Env }>();

app.use(async (c, next) => {
	const auth = bearerAuth({ token: c.env.APP_API_KEY })
	return auth(c, next)
})

app.use(logger(), contextStorage(), async (c, next) => {
	c.set('BASE_URL', c.env.BASE_URL)
	c.set('ACCESS_KEY', c.env.ACCESS_KEY)
	c.set('SECRET_KEY', c.env.SECRET_KEY)
	await next()
})

const getCreds = () => {
	const accessKey = getContext().env.ACCESS_KEY
	const baseUrl = getContext().env.BASE_URL
	const secretKey = getContext().env.SECRET_KEY
	return { accessKey, baseUrl, secretKey }
}

app.notFound((c) => c.json({ message: 'Not Found', ok: false }, 404))

app.post('/api/chat', async (c) => {

	const payload = await c.req.json();

	const messages = (typeof payload.messages === 'string' ? JSON.parse(payload.messages) : payload.messages) || [];

	const creds = getCreds();

	const openai = createOpenAI({
		apiKey: c.env.OPENAI_API_KEY,
		baseURL: c.env.OPENAI_API_URL
	});

	try {
		const result = await generateText({
			model: openai('gpt-4o-mini'),
			messages,
			system: `You are a Home Automation assistant. Always use the provided tools to perform actions or get information. Never assume the state of a device without checking. For every request:
		1. Get the device ID using the getDeviceId tool.
		2. Use the appropriate tool (turnOnOff, changeColor) to perform the action.
		3. Confirm the action has been completed by checking the tool\'s response.
		These are the available devices:
		1. A light in the bedroom
		2. A light in the living room
		3. A light in the dining room
		4. A light in the kitchen
		Always respond back to the user.

		The color of the light uses h,s,v. 0<=h<=360, 0<=s<=1000, 0<=v<=1000.
		`,
			tools: {
				turnOnOff: tool({
					description: 'Turns the [deviceId] on or off',
					parameters: z.object({
						deviceId: z.string(),
						onOff: z.boolean(),
					}),

					execute: async (args: { deviceId: string; onOff: boolean }) => {
						const { deviceId, onOff } = args;
						const result = await turnOnOff(creds, { deviceId, onOff });
						console.log('onOff', result);
						return result;
					}
				}),
				getDeviceId: tool({
					description: 'Get the ID of the device',
					parameters: z.object({
						roomName: z.string(),
					}),
					execute: async (args: { roomName: string }) => {
						let { roomName } = args;
						roomName = roomName.trim().toLowerCase().replaceAll(/\s/g, '')
						const result = await getDeviceId({ roomName }, c.env);
						console.log(`Room: ${roomName}, DeviceID: ${result}`)
						return result;
					},
				}),
				changeColor: tool({
					description: 'Change the color of the light',
					parameters: z.object({
						deviceId: z.string(),
						h: z.number(),
						s: z.number(),
						v: z.number(),
					}),
					execute: async (args: { deviceId: string; h: number; s: number; v: number }) => {
						let { deviceId, h, s, v } = args;
						const result = await changeColor(creds, { deviceId, h, s, v })
						return result;
					}
				})
			},
			maxSteps: 5
		});
		const finalMessage = messages[messages.length - 1];
		if (finalMessage.role !== 'assistant') {
			messages.push({ role: 'assistant', content: result?.text });
		}
	} catch (error) {
		console.error(error)
		throw new Error("An error occured: " + error);

	}

	return c.json({ messages });
});

// app.get('/api/lights', async (c) => {
// 	let statusCode = 418;
// 	const token = await turnOnOff(getCreds(), { deviceId: c.env.BEDROOM_DEVICE_ID, onOff: false });
// 	return c.json(token);
// });

// app.get('/api/status', async (c) => {
// 	const status = await getDeviceStatus(c.env.BEDROOM_DEVICE_ID)
// 	console.log(getCreds())
// 	return c.json(status)
// })

export default app;
