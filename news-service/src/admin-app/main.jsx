import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const initialForm = {
    title: '',
    body: '',
    imageUrl: '',
    fontSize: 16,
    publishedAt: ''
}

async function request(path, options = {}, csrfToken = '') {
    const headers = { ...(options.headers || {}) }
    if (options.body && !(options.body instanceof FormData) && !headers['content-type']) headers['content-type'] = 'application/json'
    if (['POST', 'PUT', 'DELETE'].includes(options.method)) headers['x-csrf-token'] = csrfToken
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers })
    const data = response.status === 204 ? null : await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.')
    return data
}

function ImagePicker({ value, onChange, onUpload, disabled }) {
    const inputRef = React.useRef(null)

    function chooseFile(file) {
        if (!file) return
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
            onUpload(null, 'PNG, JPG, WEBP, GIF 이미지만 사용할 수 있습니다.')
            return
        }
        if (file.size > 5 * 1024 * 1024) {
            onUpload(null, '이미지는 5MB 이하만 업로드할 수 있습니다.')
            return
        }
        onUpload(file)
    }

    return (
        <div
            className={`upload-zone ${value ? 'has-image' : ''}`}
            role="button"
            tabIndex={disabled ? -1 : 0}
            onClick={() => !disabled && inputRef.current?.click()}
            onKeyDown={(event) => {
                if (!disabled && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click()
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault()
                if (!disabled) chooseFile(event.dataTransfer.files[0])
            }}
        >
            <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                    chooseFile(event.target.files[0])
                    event.target.value = ''
                }}
                disabled={disabled}
            />
            {value ? (
                <div className="upload-preview">
                    <img src={value} alt="" referrerPolicy="no-referrer" />
                    <div className="upload-preview-actions">
                        <span>이미지 변경</span>
                        <button type="button" onClick={(event) => { event.stopPropagation(); onChange('') }}>제거</button>
                    </div>
                </div>
            ) : (
                <div className="upload-empty">
                    <span className="upload-icon" aria-hidden="true">✦</span>
                    <strong>공지 이미지를 끌어다 놓으세요</strong>
                    <small>또는 클릭해서 선택 · PNG, JPG, WEBP, GIF · 최대 5MB</small>
                </div>
            )}
        </div>
    )
}

function Message({ message }) {
    return <p className={`message ${message.error ? 'error' : ''}`} role="status">{message.text}</p>
}

function Login({ onPassword, onOtp, initialLoginId = '', initialOtp = false, message }) {
    const [loginId, setLoginId] = useState(initialLoginId)
    const [password, setPassword] = useState('')
    const [code, setCode] = useState('')
    const [step, setStep] = useState(initialOtp ? 'otp' : 'password')
    const [busy, setBusy] = useState(false)

    async function submit(event) {
        event.preventDefault()
        setBusy(true)
        try {
            if (step === 'password') {
                await onPassword(loginId, password)
                setStep('otp')
            } else {
                await onOtp(code)
            }
        } catch (error) {
            message(error.message)
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="panel">
            <div className="panel-kicker">NEBULA / ADMIN</div>
            <h1>{step === 'password' ? '관리자 로그인' : '2단계 인증'}</h1>
            <p>{step === 'password' ? '관리자 ID와 비밀번호를 입력하세요.' : 'Google Authenticator의 6자리 코드를 입력하세요.'}</p>
            <form onSubmit={submit}>
                <label htmlFor="login-id">관리자 ID</label>
                <input id="login-id" value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" maxLength="120" required disabled={step === 'otp'} />
                {step === 'password' ? (
                    <>
                        <label htmlFor="admin-password">비밀번호</label>
                        <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength="12" maxLength="200" required />
                    </>
                ) : (
                    <>
                        <label htmlFor="otp-login-code">OTP 코드</label>
                        <input id="otp-login-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" required autoFocus />
                    </>
                )}
                <button className="primary" type="submit" disabled={busy}>{busy ? '확인 중...' : step === 'password' ? '다음' : '로그인'}</button>
            </form>
        </section>
    )
}

function Setup({ onStart, onVerify, message }) {
    const [setupToken, setSetupToken] = useState('')
    const [password, setPassword] = useState('')
    const [setupData, setSetupData] = useState(null)
    const [code, setCode] = useState('')
    const [busy, setBusy] = useState(false)

    async function start(event) {
        event.preventDefault()
        setBusy(true)
        try {
            setSetupData(await onStart(setupToken, password))
        } catch (error) {
            message(error.message)
        } finally {
            setBusy(false)
        }
    }

    async function verify(event) {
        event.preventDefault()
        setBusy(true)
        try {
            await onVerify(code)
        } catch (error) {
            message(error.message)
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="panel">
            <h1>Google Authenticator 설정</h1>
            {!setupData ? (
                <>
                    <p>초기 설정 토큰과 관리자 비밀번호를 등록한 뒤 Google Authenticator를 연결하세요.</p>
                    <form onSubmit={start}>
                        <label htmlFor="setup-token">초기 설정 토큰</label>
                        <input id="setup-token" type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} autoComplete="off" required />
                        <label htmlFor="setup-password">관리자 비밀번호</label>
                        <input id="setup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength="12" maxLength="200" required />
                        <button className="primary" type="submit" disabled={busy}>{busy ? '준비 중...' : 'TOTP 등록 시작'}</button>
                    </form>
                </>
            ) : (
                <>
                    <p>Google Authenticator에서 QR 코드를 스캔한 뒤 6자리 코드를 입력하세요.</p>
                    <img className="qr" src={setupData.qrCode} alt="TOTP 설정 QR 코드" />
                    <p>수동 입력 키: <code>{setupData.secret}</code></p>
                    <form onSubmit={verify}>
                        <label htmlFor="totp-code">인증 코드</label>
                        <input id="totp-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" required />
                        <button className="primary" type="submit" disabled={busy}>{busy ? '확인 중...' : '설정 완료'}</button>
                    </form>
                </>
            )}
        </section>
    )
}

function AnnouncementForm({ form, editingId, onChange, onSubmit, onReset, onImageUpload, uploading, busy }) {
    const previewStyle = { fontSize: `${form.fontSize}px` }
    return (
        <div className="editor-grid">
            <form className="panel" onSubmit={onSubmit}>
                <div className="panel-kicker">ANNOUNCEMENT EDITOR</div>
                <label htmlFor="title">제목</label>
                <input id="title" value={form.title} onChange={(event) => onChange('title', event.target.value)} maxLength="160" required />
                <div className="field-meta"><span>본문</span><span>{form.body.length}/10000</span></div>
                <textarea id="body" value={form.body} onChange={(event) => onChange('body', event.target.value)} maxLength="10000" rows="8" required />
                <label>공지 이미지 <span className="optional">(선택)</span></label>
                <ImagePicker value={form.imageUrl} onChange={(value) => onChange('imageUrl', value)} onUpload={onImageUpload} disabled={uploading || busy} />
                {uploading && <p className="upload-status">이미지를 업로드하는 중...</p>}
                <label htmlFor="image-url">외부 이미지 URL <span className="optional">(선택)</span></label>
                <input id="image-url" type="url" value={form.imageUrl.startsWith('/news-assets/') ? '' : form.imageUrl} onChange={(event) => onChange('imageUrl', event.target.value)} placeholder="https://..." maxLength="1000" />
                <div className="form-row">
                    <div>
                        <label htmlFor="font-size">본문 글자 크기</label>
                        <input id="font-size" type="range" min="12" max="32" value={form.fontSize} onChange={(event) => onChange('fontSize', Number(event.target.value))} />
                    </div>
                    <output className="font-size-value">{form.fontSize}px</output>
                </div>
                <label htmlFor="published-at">게시일</label>
                <input id="published-at" type="datetime-local" value={form.publishedAt} onChange={(event) => onChange('publishedAt', event.target.value)} required />
                <div className="actions">
                    <button className="primary" type="submit" disabled={busy}>{busy ? '저장 중...' : editingId ? '공지 수정' : '공지 등록'}</button>
                    <button type="button" onClick={onReset}>새로 작성</button>
                </div>
            </form>
            <section className="panel preview-panel">
                <div className="panel-kicker">LIVE PREVIEW</div>
                <article className="announcement-card preview-card">
                    {form.imageUrl && <img src={form.imageUrl} alt="" referrerPolicy="no-referrer" />}
                    <h2>{form.title || '공지 제목 미리보기'}</h2>
                    <time>{form.publishedAt ? new Date(form.publishedAt).toLocaleString('ko-KR') : '게시일 미리보기'}</time>
                    <p style={previewStyle}>{form.body || '공지 본문이 이곳에 표시됩니다.'}</p>
                </article>
            </section>
        </div>
    )
}

function Dashboard({ announcements, form, editingId, busy, uploading, onChange, onSubmit, onReset, onImageUpload, onEdit, onDelete, onLogout }) {
    return (
        <>
            <div className="dashboard-heading">
                <div><h1>공지 관리</h1><p>게시된 공지는 웹사이트와 런처의 공개 API에 표시됩니다.</p></div>
                <button type="button" onClick={onLogout}>로그아웃</button>
            </div>
            <AnnouncementForm form={form} editingId={editingId} onChange={onChange} onSubmit={onSubmit} onReset={onReset} onImageUpload={onImageUpload} uploading={uploading} busy={busy} />
            <div className="announcement-list">
                {!announcements.length && <p className="muted">등록된 공지가 없습니다.</p>}
                {announcements.map((item) => (
                    <article className="announcement-card" key={item.id}>
                        {item.imageUrl && <img src={item.imageUrl} alt="" referrerPolicy="no-referrer" />}
                        <h3>{item.title}</h3>
                        <time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleString('ko-KR')}</time>
                        <p style={{ fontSize: `${item.fontSize || 16}px` }}>{item.body}</p>
                        <div className="actions">
                            <button type="button" onClick={() => onEdit(item)}>수정</button>
                            <button className="danger" type="button" onClick={() => onDelete(item.id)}>삭제</button>
                        </div>
                    </article>
                ))}
            </div>
        </>
    )
}

function App() {
    const [view, setView] = useState('loading')
    const [csrfToken, setCsrfToken] = useState('')
    const [announcements, setAnnouncements] = useState([])
    const [editingId, setEditingId] = useState(null)
    const [form, setForm] = useState(initialForm)
    const [busy, setBusy] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [pendingTotp, setPendingTotp] = useState(false)
    const [statusLoginId, setStatusLoginId] = useState('')
    const [messageState, setMessageState] = useState({ text: '', error: false })

    const message = useCallback((text, error = true) => setMessageState({ text, error }), [])

    const loadAnnouncements = useCallback(async () => {
        const data = await request('/api/v1/admin/announcements', {}, csrfToken)
        setAnnouncements(data.announcements)
    }, [csrfToken])

    const resetForm = useCallback(() => {
        setEditingId(null)
        setForm({ ...initialForm, publishedAt: new Date().toISOString().slice(0, 16) })
    }, [])

    useEffect(() => {
        request('/auth/status')
            .then(async (status) => {
                setCsrfToken(status.csrfToken || '')
                setStatusLoginId(status.loginId || '')
                setPendingTotp(Boolean(status.requiresTotp && status.csrfToken))
                if (status.authenticated) {
                    setView('dashboard')
                    resetForm()
                } else if (status.setupRequired) {
                    setView('setup')
                } else {
                    setView('login')
                }
            })
            .catch((error) => {
                message(error.message)
                setView('login')
            })
    }, [message, resetForm])

    useEffect(() => {
        if (view === 'dashboard' && csrfToken) loadAnnouncements().catch((error) => message(error.message))
    }, [view, csrfToken, loadAnnouncements, message])

    const onPassword = async (loginId, password) => {
        const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ loginId, password }) })
        setCsrfToken(data.csrfToken)
        setPendingTotp(true)
        message('비밀번호 확인됨. OTP를 입력하세요.', false)
    }

    const onOtp = async (code) => {
        const data = await request('/auth/totp/verify', { method: 'POST', body: JSON.stringify({ code }) }, csrfToken)
        setCsrfToken(data.csrfToken)
        setPendingTotp(false)
        setView('dashboard')
        resetForm()
        message('인증되었습니다.', false)
    }

    const onStartSetup = async (setupToken, password) => {
        const data = await request('/auth/totp/setup', { method: 'POST', body: JSON.stringify({ setupToken, password }) })
        setCsrfToken(data.csrfToken)
        return data
    }

    const onImageUpload = async (file, errorMessage) => {
        if (errorMessage) {
            message(errorMessage)
            return
        }
        setUploading(true)
        try {
            const data = new FormData()
            data.append('image', file)
            const response = await request('/api/v1/admin/uploads/image', { method: 'POST', body: data }, csrfToken)
            setForm((current) => ({ ...current, imageUrl: response.url }))
            message('이미지를 업로드했습니다.', false)
        } catch (error) {
            message(error.message)
        } finally {
            setUploading(false)
        }
    }

    const onVerifySetup = async (code) => {
        const data = await request('/auth/totp/verify', { method: 'POST', body: JSON.stringify({ code }) }, csrfToken)
        setCsrfToken(data.csrfToken)
        setPendingTotp(false)
        setView('dashboard')
        resetForm()
        message('OTP 설정이 완료되었습니다.', false)
    }

    const onSubmit = async (event) => {
        event.preventDefault()
        setBusy(true)
        try {
            const payload = { ...form, publishedAt: new Date(form.publishedAt).toISOString() }
            const path = editingId ? `/api/v1/admin/announcements/${encodeURIComponent(editingId)}` : '/api/v1/admin/announcements'
            await request(path, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) }, csrfToken)
            resetForm()
            await loadAnnouncements()
            message(editingId ? '공지를 수정했습니다.' : '공지를 등록했습니다.', false)
        } catch (error) {
            message(error.message)
        } finally {
            setBusy(false)
        }
    }

    const onDelete = async (id) => {
        if (!window.confirm('이 공지를 삭제할까요?')) return
        try {
            await request(`/api/v1/admin/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' }, csrfToken)
            await loadAnnouncements()
            message('공지를 삭제했습니다.', false)
        } catch (error) {
            message(error.message)
        }
    }

    const onLogout = async () => {
        try {
            await request('/auth/logout', { method: 'POST' }, csrfToken)
            window.location.reload()
        } catch (error) {
            message(error.message)
        }
    }

    const content = useMemo(() => {
        if (view === 'loading') return <section className="panel"><p>불러오는 중...</p></section>
        if (view === 'login') return <Login onPassword={onPassword} onOtp={onOtp} initialLoginId={statusLoginId} initialOtp={Boolean(csrfToken && pendingTotp)} message={message} />
        if (view === 'setup') return <Setup onStart={onStartSetup} onVerify={onVerifySetup} message={message} />
        return <Dashboard announcements={announcements} form={form} editingId={editingId} busy={busy} uploading={uploading} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onSubmit={onSubmit} onReset={resetForm} onImageUpload={onImageUpload} onEdit={(item) => { setEditingId(item.id); setForm({ title: item.title, body: item.body, imageUrl: item.imageUrl || '', fontSize: item.fontSize || 16, publishedAt: new Date(item.publishedAt).toISOString().slice(0, 16) }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} onDelete={onDelete} onLogout={onLogout} />
    }, [announcements, busy, editingId, form, message, view, csrfToken, pendingTotp, statusLoginId, uploading])

    return (
        <main className="shell">
            <header><strong>NEBULA / ADMIN</strong><a href="/" rel="noreferrer">사이트로 돌아가기</a></header>
            <Message message={messageState} />
            {content}
        </main>
    )
}

createRoot(document.getElementById('root')).render(<App />)
