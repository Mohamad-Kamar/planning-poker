function encodeRemainingLength(length) {
    const bytes = [];
    let value = length;
    do {
        let digit = value % 128;
        value = Math.floor(value / 128);
        if (value > 0) digit |= 0x80;
        bytes.push(digit);
    } while (value > 0);
    return Uint8Array.from(bytes);
}

function packet(typeAndFlags, body) {
    const payload = body || new Uint8Array(0);
    const header = Uint8Array.from([typeAndFlags]);
    const remaining = encodeRemainingLength(payload.length);
    const output = new Uint8Array(header.length + remaining.length + payload.length);
    output.set(header, 0);
    output.set(remaining, header.length);
    output.set(payload, header.length + remaining.length);
    return output;
}

function buildConnack() {
    return packet(0x20, Uint8Array.from([0x00, 0x00]));
}

function buildSuback(packetIdMsb, packetIdLsb) {
    return packet(0x90, Uint8Array.from([packetIdMsb, packetIdLsb, 0x00]));
}

function encodeUtf8String(value) {
    const bytes = new TextEncoder().encode(value);
    const output = new Uint8Array(2 + bytes.length);
    output[0] = (bytes.length >> 8) & 0xff;
    output[1] = bytes.length & 0xff;
    output.set(bytes, 2);
    return output;
}

module.exports = {
    encodeRemainingLength,
    packet,
    buildConnack,
    buildSuback,
    encodeUtf8String
};
