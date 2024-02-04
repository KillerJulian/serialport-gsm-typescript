import 'w3c-web-serial';
import { Communicator } from '../utils/Communicator';

export class WebSerialCommunicator implements Communicator {
	private readonly serialPort: SerialPort;
	private readonly serialPortOptions: SerialOptions;

	private readonly textEncoder: TextEncoderStream;
	private readonly textDecoder: TextDecoderStream;

	private readonly writer: WritableStreamDefaultWriter<string>;
	private readonly reader: ReadableStreamDefaultReader<string>;

	private writableStreamClosed: Promise<void> | null = null;
	private readableStreamClosed: Promise<void> | null = null;

	private readInterval: NodeJS.Timer | null = null;
	private onResiveFunc: ((data: string) => void) | null = null;

	constructor(port: SerialPort, options: Partial<SerialOptions> = {}) {
		this.serialPort = port;

		this.serialPortOptions = Object.assign(
			// defaults
			{
				baudRate: 9600,
				dataBits: 8,
				stopBits: 1,
				parity: 'none'
			},
			// options
			options
		);

		this.textEncoder = new TextEncoderStream();
		this.writer = this.textEncoder.writable.getWriter();

		this.textDecoder = new TextDecoderStream();
		this.reader = this.textDecoder.readable.getReader();
	}

	get deviceIndentifier() {
		return `webserial-${this.serialPort.getInfo().usbProductId?.toString(16) || 'unknown'}`;
	}

	get isConnected() {
		return this.serialPort.readable !== null && this.serialPort.writable !== null;
	}

	async connect() {
		if (this.isConnected) {
			return;
		}

		await this.serialPort.open(this.serialPortOptions);

		this.writableStreamClosed = this.textEncoder.readable.pipeTo(this.serialPort.writable as WritableStream<Uint8Array>);
		this.readableStreamClosed = (this.serialPort.readable as ReadableStream<Uint8Array>).pipeTo(this.textDecoder.writable);

		const readData = async () => {
			try {
				const { value, done } = await this.reader.read();

				if (this.onResiveFunc !== null) {
					this.onResiveFunc(value || '');
				}

				if (done) {
					this.reader.releaseLock();
				}
			} catch (error) {
				// TODO: Handle error
			}
		};

		this.readInterval = setInterval(readData, 10);
	}

	async disconnect() {
		if (!this.isConnected) {
			return;
		}

		if (this.readInterval !== null) {
			clearInterval(this.readInterval);
			this.readInterval = null;
		}

		await this.reader.cancel();
		await this.readableStreamClosed;
		this.readableStreamClosed = null;

		await this.writer.close();
		await this.writableStreamClosed;
		this.writableStreamClosed = null;

		await this.serialPort.close();
	}

	async revokeConnection() {
		if (!('forget' in SerialPort.prototype)) {
			throw new Error('Cannot revoke access of this port serial. This function is not supported.');
		}

		this.serialPort.forget();
	}

	async write(data: string) {
		await this.writer.write(data);
	}

	async setOnResiveFunc(func: (data: string) => void) {
		this.onResiveFunc = func;
	}

	/**
	 * Retrieves a list of available serial ports.
	 * @see https://wicg.github.io/serial/#getports-method
	 */
	static async listDevices() {
		if (!navigator || !('serial' in navigator)) {
			return [];
		}

		return await navigator.serial.getPorts();
	}
}
