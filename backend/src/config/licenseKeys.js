/**
 * @file backend/src/config/licenseKeys.js
 * @description 授权验证用的「公钥 + 对称密钥」。
 *
 * 这里只放公钥，私钥永远只在作者的授权码生成器项目（it-ops-license-gen）里。
 * 没有私钥就无法伪造授权码；公钥只能验证，造不出新码。这满足了「授权码是不可逆加密字符串」的要求。
 *
 * 若作者更换了密钥对（私钥泄露），只需同步更新下面两个常量，并重新生成所有授权码。
 * 算法必须与生成器 lib/crypto.js 完全一致：RSA-SHA256(PKCS#1 v1.5) 签名 + AES-256-GCM 加密。
 */

// RSA 公钥（SPKI / PEM），用于验证授权码签名
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApxmrhK1/5CALiw4dS+8n
Ans92L979P3qq3cKZFcfuhEyEkeIrsTkz2NWDZWsDGU1QhyzHOFBsKW8SRnXlsoC
jkNccGELNHj/4c9RHk0lYbrV3BxNAUfbJ7OIMO4YYCp6yf28f6ngp66SYSfR5VH5
Oin9nE4QW5gVIEkSFoKtU6dtBvo/6o3KoSOL0CjDUXg5paKnDX74s26MyQ7Z3nmc
VHcwLF2/cFjnv28ae4XfaCTEApfAwiXsplvbLV6PJfatNo26ofr81L5yYk09HIPI
849tTwSAiLWXZVprRn9K/rFpEbF/vI3oKPcWB7KEIKisoiJs8M9stX9KcuNfHYpA
2wIDAQAB
-----END PUBLIC KEY-----`

// AES-256-GCM 对称密钥（base64），与生成器 aes.key 一致，用于解密授权码载荷
const AES_KEY_B64 = 'EV/zWTrTHLGIsgBLBRaU7pRYmuuT4+TcRmoMgbkoKGY='

module.exports = { PUBLIC_KEY_PEM, AES_KEY_B64 }
