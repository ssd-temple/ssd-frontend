"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "../divine/AuthShell";
import DivineInput from "../divine/DivineInput";
import DivineButton from "../divine/DivineButton";
import StatusBanner from "../divine/StatusBanner";
import PasswordStrengthMeter from "../divine/PasswordStrengthMeter";
import SuccessState, { CheckIcon } from "../divine/SuccessState";
import { LockIcon } from "../divine/icons";
import { EmblemLoader } from "../divine/EmblemLoader";
import { authApi, extractErrorMessage, unwrap, type ApiEnvelope } from "../../lib/api";
import { useAsyncAction } from "../../lib/useAsyncAction";
import { newPasswordPairSchema } from "../../lib/validation";
import { checkPasswordStrength } from "../../lib/password";

type FormValues = { newPassword: string; confirmPassword: string };
type TokenInfo = { name: string; email: string; mobileNumber: string | null };

const SUCCESS_REDIRECT_DELAY_MS = 2200;

/**
 * Same shape as HEB's activation flow — reached from the "set your password"
 * email link, and doubles as the reset-password screen.
 *
 * `token` comes in as a prop rather than being read here: Next's dynamic
 * route params ([token]) are only available in the server page component,
 * which unwraps them and passes the plain string down to this client view.
 */
export default function SetPasswordView({
  mode,
  token,
  loginHref = "/admin/login",
  backdrop = "admin-photo",
}: {
  mode: "activate" | "reset";
  token: string;
  /** Where "Back to sign in" and the post-success redirect send the user — the customer
   * portal reuses this view but must never drop a devotee onto the staff admin login. */
  loginHref?: string;
  backdrop?: "divine" | "admin-photo";
}) {
  const router = useRouter();
  const [success, setSuccess] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [checkingToken, setCheckingToken] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const endpoint = mode === "activate" ? `/auth/activation/${token}` : `/auth/reset-password/${token}`;

    authApi
      .get<ApiEnvelope<TokenInfo>>(endpoint)
      .then((response) => {
        if (!cancelled) setTokenInfo(unwrap(response));
      })
      .catch((err) => {
        if (!cancelled) setTokenError(extractErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setCheckingToken(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, mode]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(newPasswordPairSchema) });

  const password = watch("newPassword") ?? "";
  const personalTerms = useMemo(
    () => [tokenInfo?.name, tokenInfo?.email, tokenInfo?.mobileNumber ?? undefined],
    [tokenInfo]
  );
  const strength = useMemo(() => checkPasswordStrength(password, personalTerms), [password, personalTerms]);

  const { run, submitting, error, setError } = useAsyncAction(async (values: FormValues) => {
    if (!strength.ok) {
      setError("Please meet all password requirements below before continuing.");
      return;
    }
    const endpoint = mode === "activate" ? "/auth/activate" : "/auth/reset-password";
    await authApi.post(endpoint, { token, ...values });
    setSuccess(true);
    setTimeout(() => router.push(loginHref), SUCCESS_REDIRECT_DELAY_MS);
  });

  const copy =
    mode === "activate"
      ? {
          eyebrow: "Welcome to the Temple",
          title: "Create Your Password",
          subtitle: tokenInfo ? `Dear ${tokenInfo.name.split(" ")[0]} — set a password only you know.` : "This is your first step inside — set a password only you know.",
        }
      : {
          eyebrow: "Sri Siva Durga Temple",
          title: "Reset Your Password",
          subtitle: tokenInfo ? `Dear ${tokenInfo.name.split(" ")[0]} — choose a new password to continue.` : "Choose a new password to continue your seva.",
        };

  return (
    <AuthShell eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} backdrop={backdrop}>
      {checkingToken ? (
        <div className="flex justify-center py-6">
          <EmblemLoader size="sm" label="Checking link…" />
        </div>
      ) : tokenError ? (
        <div
          role="alert"
          className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-1 pb-1 text-center sm:px-2"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-crimson-500/30 bg-crimson-500/10 text-crimson-600">
            <svg className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 6a1 1 0 112 0v4a1 1 0 11-2 0V6zm1 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 14z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <div className="w-full min-w-0 space-y-1.5">
            <p className="font-accent text-[12px] font-bold uppercase tracking-[0.16em] text-crimson-600">
              This link can&apos;t be used
            </p>
            <p className="break-words text-[14.5px] leading-relaxed text-crimson-600 sm:text-[15px]">{tokenError}</p>
          </div>
          <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
            {mode === "reset" && (
              <Link
                href={loginHref.replace(/\/login$/, "/forgot-password")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-crimson-500 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-crimson-600 sm:flex-none"
              >
                Request a new link
              </Link>
            )}
            <Link
              href={loginHref}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 py-2 text-[14px] font-medium text-[#e8590c] underline-offset-2 hover:underline sm:flex-none"
            >
              ← Back to sign in
            </Link>
          </div>
          {mode === "activate" && (
            <p className="text-[12.5px] leading-relaxed text-ink-500/80">
              Need a new activation email? Please contact your temple administrator.
            </p>
          )}
        </div>
      ) : success ? (
        <SuccessState
          icon={<CheckIcon />}
          title="Password set successfully"
          subtitle="Taking you to sign in…"
        />
      ) : (
        <form onSubmit={handleSubmit(run)} noValidate>
          {error && <StatusBanner tone="error">{error}</StatusBanner>}

          <div className="space-y-5">
            <div>
              <DivineInput
                label="New password"
                type="password"
                revealable
                autoComplete="new-password"
                icon={<LockIcon />}
                error={errors.newPassword?.message}
                {...register("newPassword")}
              />
              <PasswordStrengthMeter check={strength} show={password.length > 0} />
            </div>

            <DivineInput
              label="Confirm new password"
              type="password"
              revealable
              autoComplete="new-password"
              icon={<LockIcon />}
              error={errors.confirmPassword?.message}
              {...register("confirmPassword")}
            />
          </div>

          <div className="mt-6">
            <DivineButton type="submit" variant="flame" loading={submitting}>
              {mode === "activate" ? "Set Password & Continue" : "Reset Password"}
            </DivineButton>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
