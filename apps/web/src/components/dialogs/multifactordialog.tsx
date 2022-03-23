import React, {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Text, Flex, Button, Box, BoxProps } from "rebass";
import Dialog from "./dialog";
import { db } from "../../common/db";
import { ReactComponent as MFA } from "../../assets/mfa.svg";
import { ReactComponent as Fallback2FA } from "../../assets/fallback2fa.svg";
import * as clipboard from "clipboard-polyfill/text";
import { Suspense } from "react";
import FileSaver from "file-saver";
import {
  Loading,
  MFAAuthenticator,
  MFAEmail,
  MFASMS,
  Download,
  Print,
  Copy,
  Refresh,
} from "../icons";
import Field from "../field";
import { useSessionState } from "../../utils/hooks";
import { exportToPDF } from "../../common/export";
import { useTimer } from "../../hooks/use-timer";
import { phone } from "phone";
import { showMultifactorDialog } from "../../common/dialog-controller";
const QRCode = React.lazy(() => import("../../re-exports/react-qrcode-logo"));

export type AuthenticatorType = "app" | "sms" | "email";
type StepKeys = keyof Steps; // "choose" | "setup" | "recoveryCodes" | "finish";
type FallbackStepKeys = keyof FallbackSteps;
type Steps = typeof steps;
type FallbackSteps = typeof fallbackSteps;

type Authenticator = {
  type: AuthenticatorType;
  title: string;
  subtitle: string;
  icon: React.FunctionComponent<BoxProps>;
  recommended?: boolean;
};

type StepComponentProps = {
  onNext: (...args: any[]) => void;
  onClose?: () => void;
  onError?: (error: string) => void;
};

type StepComponent = React.FunctionComponent<StepComponentProps>;

type Step = {
  title?: string;
  description?: string;
  component?: StepComponent;
  next?: StepKeys;
  cancellable?: boolean;
};
type FallbackStep = Step & {
  next?: FallbackStepKeys;
};

type SubmitCodeFunction = (code: string) => void;

type AuthenticatorSelectorProps = StepComponentProps & {
  authenticator: AuthenticatorType;
  isFallback?: boolean;
};

type VerifyAuthenticatorFormProps = PropsWithChildren<{
  codeHelpText: string;
  onSubmitCode: SubmitCodeFunction;
}>;

type SetupAuthenticatorProps = { onSubmitCode: SubmitCodeFunction };

type MultifactorDialogProps = {
  onClose: () => void;
  primaryMethod?: AuthenticatorType;
};

type RecoveryCodesDialogProps = {
  onClose: () => void;
  primaryMethod: AuthenticatorType;
};

const defaultAuthenticators: AuthenticatorType[] = ["app", "sms", "email"];
const Authenticators: Authenticator[] = [
  {
    type: "app",
    title: "Set up using an Authenticator app",
    subtitle:
      "Use an authenticator app like Aegis or Raivo Authenticator to get the authentication codes.",
    icon: MFAAuthenticator,
    recommended: true,
  },
  {
    type: "sms",
    title: "Set up using SMS",
    subtitle: "Notesnook will send you an SMS text with the 2FA code at login.",
    icon: MFASMS,
  },
  {
    type: "email",
    title: "Set up using Email",
    subtitle: "Notesnook will send you the 2FA code on your email at login.",
    icon: MFAEmail,
  },
];

const steps = {
  choose: (): Step => ({
    title: "Protect your notes by enabling 2FA",
    description: "Choose how you want to receive your authentication codes.",
    component: ({ onNext }) => (
      <ChooseAuthenticator
        onNext={onNext}
        authenticators={defaultAuthenticators}
      />
    ),
    next: "setup",
    cancellable: true,
  }),
  setup: (authenticator: Authenticator): Step => ({
    title: authenticator.title,
    description: authenticator.subtitle,
    next: "recoveryCodes",
    component: ({ onNext }) => (
      <AuthenticatorSelector
        onNext={onNext}
        authenticator={authenticator.type}
      />
    ),
  }),
  recoveryCodes: (authenticatorType: AuthenticatorType): Step => ({
    title: "Save your recovery codes",
    description: `If you lose access to your ${
      authenticatorType === "email"
        ? "email"
        : authenticatorType === "sms"
        ? "phone"
        : "auth app"
    }, you can login to Notesnook using your recovery codes. Each code can only be used once!`,
    component: ({ onNext, onClose, onError }) => (
      <BackupRecoveryCodes
        onClose={onClose}
        onNext={onNext}
        onError={onError}
        authenticatorType={authenticatorType}
      />
    ),
    next: "finish",
  }),
  finish: (authenticatorType: AuthenticatorType): Step => ({
    component: ({ onNext, onClose, onError }) => (
      <TwoFactorEnabled
        onClose={onClose}
        onNext={onNext}
        onError={onError}
        authenticatorType={authenticatorType}
      />
    ),
  }),
} as const;

const fallbackSteps = {
  choose: (primaryMethod: AuthenticatorType): FallbackStep => ({
    title: "Add a fallback 2FA method",
    description:
      "A fallback method helps you get your 2FA codes on an alternative device in case you lose your primary device.",
    component: ({ onNext }) => (
      <ChooseAuthenticator
        onNext={onNext}
        authenticators={defaultAuthenticators.filter(
          (i) => i !== primaryMethod
        )}
      />
    ),
    next: "setup",
    cancellable: true,
  }),
  setup: (authenticator: Authenticator): FallbackStep => ({
    title: authenticator.title,
    description: authenticator.subtitle,
    next: "finish",
    cancellable: true,
    component: ({ onNext }) => (
      <AuthenticatorSelector
        onNext={onNext}
        authenticator={authenticator.type}
        isFallback
      />
    ),
  }),
  finish: (
    fallbackMethod: AuthenticatorType,
    primaryMethod: AuthenticatorType
  ): FallbackStep => ({
    component: ({ onNext, onClose }) => (
      <Fallback2FAEnabled
        onNext={onNext}
        onClose={onClose}
        primaryMethod={primaryMethod}
        fallbackMethod={fallbackMethod}
      />
    ),
  }),
} as const;

export function MultifactorDialog(props: MultifactorDialogProps) {
  const { onClose, primaryMethod } = props;
  const [step, setStep] = useState<FallbackStep | Step>(
    primaryMethod ? fallbackSteps.choose(primaryMethod) : steps.choose()
  );
  const [error, setError] = useState<string>();

  return (
    <Dialog
      isOpen={true}
      title={step.title}
      description={step.description}
      width={500}
      positiveButton={
        step.next
          ? {
              text: "Continue",
              props: { form: "2faForm" },
            }
          : null
      }
      negativeButton={
        step.cancellable
          ? {
              text: "Cancel",
              onClick: onClose,
            }
          : null
      }
    >
      {step.component && (
        <step.component
          onNext={(...args) => {
            if (!step.next) return onClose();

            const nextStepCreator: Function =
              step.next !== "recoveryCodes" && primaryMethod
                ? fallbackSteps[step.next]
                : steps[step.next];

            const nextStep = primaryMethod
              ? nextStepCreator(...args, primaryMethod)
              : nextStepCreator(...args);

            setStep(nextStep);
          }}
          onError={setError}
          onClose={onClose}
        />
      )}
      {error && (
        <Text variant={"error"} bg="errorBg" p={1} mt={2}>
          {error}
        </Text>
      )}
    </Dialog>
  );
}

export function RecoveryCodesDialog(props: RecoveryCodesDialogProps) {
  const { onClose, primaryMethod } = props;
  const [error, setError] = useState<string>();
  const step = steps.recoveryCodes(primaryMethod);

  return (
    <Dialog
      isOpen={true}
      title={step.title}
      description={step.description}
      width={500}
      positiveButton={{
        text: "Okay",
        onClick: onClose,
      }}
    >
      {step.component && (
        <step.component onNext={() => {}} onError={setError} />
      )}
      {error && (
        <Text variant={"error"} bg="errorBg" p={1} mt={2}>
          {error}
        </Text>
      )}
    </Dialog>
  );
}

type ChooseAuthenticatorProps = StepComponentProps & {
  authenticators: AuthenticatorType[];
};

function ChooseAuthenticator(props: ChooseAuthenticatorProps) {
  const [selected, setSelected] = useSessionState("selectedAuthenticator", 0);
  const { authenticators, onNext } = props;
  const filteredAuthenticators = authenticators.map(
    (a) => Authenticators.find((auth) => auth.type === a)!
  );
  return (
    <Flex
      as="form"
      id="2faForm"
      flexDirection="column"
      flex={1}
      sx={{ overflow: "hidden" }}
      onSubmit={(e) => {
        e.preventDefault();
        const authenticator = filteredAuthenticators[selected];
        onNext(authenticator);
      }}
    >
      {filteredAuthenticators.map((auth, index) => (
        <Button
          type="button"
          variant={"secondary"}
          mt={2}
          sx={{
            ":first-of-type": { mt: 2 },
            display: "flex",
            justifyContent: "start",
            alignItems: "start",
            textAlign: "left",
            bg: "transparent",
            px: 0,
          }}
          onClick={() => setSelected(index)}
        >
          <auth.icon
            className="2fa-icon"
            sx={{
              bg: selected === index ? "shade" : "bgSecondary",
              borderRadius: 100,
              width: 35,
              height: 35,
              mr: 2,
            }}
            size={16}
            color={selected === index ? "primary" : "text"}
          />
          <Text variant={"title"} fontWeight="body">
            {auth.title}{" "}
            {auth.recommended ? (
              <Text
                as="span"
                variant={"subBody"}
                color="primary"
                bg="shade"
                px={1}
                sx={{ borderRadius: "default" }}
              >
                Recommended
              </Text>
            ) : (
              false
            )}
            <Text variant="body" fontWeight="normal" mt={1}>
              {auth.subtitle}
            </Text>
          </Text>
        </Button>
      ))}
    </Flex>
  );
}

function AuthenticatorSelector(props: AuthenticatorSelectorProps) {
  const { authenticator, isFallback, onNext, onError } = props;
  const onSubmitCode: SubmitCodeFunction = useCallback(
    async (code) => {
      try {
        if (isFallback) await db.mfa?.enableFallback(authenticator, code);
        else await db.mfa!.enable(authenticator, code);
        onNext(authenticator);
      } catch (e) {
        const error = e as Error;
        onError && onError(error.message);
      }
    },
    [authenticator, onError, onNext, isFallback]
  );

  return authenticator === "app" ? (
    <SetupAuthenticatorApp onSubmitCode={onSubmitCode} />
  ) : authenticator === "email" ? (
    <SetupEmail onSubmitCode={onSubmitCode} />
  ) : authenticator === "sms" ? (
    <SetupSMS onSubmitCode={onSubmitCode} />
  ) : null;
}

function SetupAuthenticatorApp(props: SetupAuthenticatorProps) {
  const { onSubmitCode } = props;
  const [authenticatorDetails, setAuthenticatorDetails] = useState({
    sharedKey: null,
    authenticatorUri: null,
  });

  useEffect(() => {
    (async function () {
      setAuthenticatorDetails(await db.mfa!.setup("app"));
    })();
  }, []);

  return (
    <VerifyAuthenticatorForm
      codeHelpText={
        "After scanning the QR code image, the app will display a code that you can enter below."
      }
      onSubmitCode={onSubmitCode}
    >
      <Text variant={"body"}>
        Scan the QR code below with your authenticator app.
      </Text>
      <Box alignSelf={"center"}>
        {authenticatorDetails.authenticatorUri ? (
          <Suspense fallback={<Loading />}>
            <QRCode
              value={authenticatorDetails.authenticatorUri}
              ecLevel={"M"}
              size={150}
            />
          </Suspense>
        ) : (
          <Loading />
        )}
      </Box>
      <Text variant={"subBody"}>
        If you can't scan the QR code above, enter this text instead (spaces
        don't matter):
      </Text>
      <Text
        mt={2}
        bg="bgSecondary"
        p={2}
        fontFamily="monospace"
        fontSize="body"
        sx={{ borderRadius: "default", overflowWrap: "anywhere" }}
      >
        {authenticatorDetails.sharedKey ? (
          authenticatorDetails.sharedKey
        ) : (
          <Loading />
        )}
      </Text>
    </VerifyAuthenticatorForm>
  );
}

function SetupEmail(props: SetupAuthenticatorProps) {
  const { onSubmitCode } = props;
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const { elapsed, enabled, setEnabled } = useTimer(`2fa.email`, 60);
  const [email, setEmail] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      const { email } = await db.user!.getUser();
      setEmail(email);
    })();
  }, []);

  return (
    <VerifyAuthenticatorForm
      codeHelpText={
        "You will receive a 2FA code on your email address which you can enter below"
      }
      onSubmitCode={onSubmitCode}
    >
      <Flex
        mt={2}
        bg="bgSecondary"
        alignItems={"center"}
        sx={{ borderRadius: "default", overflowWrap: "anywhere" }}
      >
        <Text ml={2} fontFamily="monospace" fontSize="subtitle" flex={1}>
          {email}
        </Text>
        <Button
          type="button"
          variant={"secondary"}
          alignSelf={"center"}
          sx={{ p: 2, m: 0 }}
          disabled={isSending || !enabled}
          onClick={async () => {
            setIsSending(true);
            try {
              await db.mfa!.setup("email");
              setEnabled(false);
            } catch (e) {
              const error = e as Error;
              console.error(error);
              setError(error.message);
            } finally {
              setIsSending(false);
            }
          }}
        >
          {isSending ? (
            <Loading size={18} />
          ) : enabled ? (
            `Send code`
          ) : (
            `Resend (${elapsed})`
          )}
        </Button>
      </Flex>
      {error ? (
        <Text
          variant={"error"}
          bg="errorBg"
          p={1}
          sx={{ borderRadius: "default" }}
          mt={1}
        >
          {error}
        </Text>
      ) : null}
    </VerifyAuthenticatorForm>
  );
}

function SetupSMS(props: SetupAuthenticatorProps) {
  const { onSubmitCode } = props;
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const [phoneNumber, setPhoneNumber] = useState<string>();
  const { elapsed, enabled, setEnabled } = useTimer(`2fa.sms`, 60);
  const inputRef = useRef<HTMLInputElement>();

  return (
    <VerifyAuthenticatorForm
      codeHelpText={
        "You will receive a 2FA code on your phone number which you can enter below"
      }
      onSubmitCode={onSubmitCode}
    >
      <Field
        inputRef={inputRef}
        id="phone-number"
        name="phone-number"
        helpText="Authentication codes will be sent to this number"
        label="Phone number"
        sx={{ mt: 2 }}
        autoFocus
        required
        styles={{
          input: { flex: 1 },
        }}
        placeholder={"+1234567890"}
        onChange={() => {
          const number = inputRef.current?.value;
          if (!number) return setError("");
          const validationResult = phone(number);

          if (validationResult.isValid) {
            setPhoneNumber(validationResult.phoneNumber);
            setError("");
          } else {
            setPhoneNumber("");
            setError("Please enter a valid phone number with country code.");
          }
        }}
        action={{
          disabled: error || isSending || !enabled,
          component: (
            <Text variant={"body"}>
              {isSending ? (
                <Loading size={18} />
              ) : enabled ? (
                `Send code`
              ) : (
                `Resend (${elapsed})`
              )}
            </Text>
          ),
          onClick: async () => {
            if (!phoneNumber) {
              setError("Please provide a phone number.");
              return;
            }

            setIsSending(true);
            try {
              await db.mfa!.setup("sms", phoneNumber);
              setEnabled(false);
            } catch (e) {
              const error = e as Error;
              console.error(error);
              setError(error.message);
            } finally {
              setIsSending(false);
            }
          },
        }}
      />
      {error ? (
        <Text
          variant={"error"}
          bg="errorBg"
          p={1}
          sx={{ borderRadius: "default" }}
          mt={1}
        >
          {error}
        </Text>
      ) : null}
    </VerifyAuthenticatorForm>
  );
}

function BackupRecoveryCodes(props: TwoFactorEnabledProps) {
  const { onNext, onError } = props;
  const [codes, setCodes] = useState<string[]>([]);
  const recoveryCodesRef = useRef<HTMLDivElement>();
  const generate = useCallback(async () => {
    onError && onError("");
    try {
      const codes = await db.mfa?.codes();
      if (codes) setCodes(codes);
    } catch (e) {
      const error = e as Error;
      onError && onError(error.message);
    }
  }, [onError]);

  useEffect(() => {
    (async function () {
      await generate();
    })();
  }, [generate]);

  const actions = useMemo(
    () => [
      {
        title: "Print",
        icon: Print,
        action: async () => {
          if (!recoveryCodesRef.current) return;
          await exportToPDF(
            "Notesnook 2FA Recovery Codes",
            recoveryCodesRef.current.outerHTML
          );
        },
      },
      {
        title: "Copy",
        icon: Copy,
        action: async () => {
          await clipboard.writeText(codes.join("\n"));
        },
      },
      {
        title: "Download",
        icon: Download,
        action: () => {
          FileSaver.saveAs(
            new Blob([Buffer.from(codes.join("\n"))]),
            `notesnook-recovery-codes.txt`
          );
        },
      },
      { title: "Regenerate", icon: Refresh, action: generate },
    ],
    [codes, generate]
  );

  return (
    <Flex
      flexDirection={"column"}
      as="form"
      id="2faForm"
      onSubmit={(e) => {
        e.preventDefault();
        onNext(props.authenticatorType);
      }}
    >
      <Box
        className="selectable"
        ref={recoveryCodesRef}
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          bg: "bgSecondary",
          p: 2,
          borderRadius: "default",
        }}
      >
        {codes.map((code) => (
          <Text
            className="selectable"
            as="code"
            variant={"subheading"}
            textAlign="center"
            fontWeight="body"
            fontFamily={"monospace"}
          >
            {code}
          </Text>
        ))}
      </Box>
      <Flex sx={{ justifyContent: "start", alignItems: "center", mt: 2 }}>
        {actions.map((action) => (
          <Button
            type="button"
            variant="secondary"
            mr={1}
            py={1}
            sx={{ display: "flex", alignItems: "center" }}
            onClick={action.action}
          >
            <action.icon size={15} sx={{ mr: "2px" }} />
            {action.title}
          </Button>
        ))}
      </Flex>
    </Flex>
  );
}

type TwoFactorEnabledProps = StepComponentProps & {
  authenticatorType: AuthenticatorType;
};
function TwoFactorEnabled(props: TwoFactorEnabledProps) {
  return (
    <Flex
      flexDirection={"column"}
      justifyContent="center"
      alignItems={"center"}
      mb={2}
    >
      <MFA width={120} />
      <Text variant={"heading"} fontSize="subheading" mt={2} textAlign="center">
        Two-factor authentication enabled!
      </Text>
      <Text variant={"body"} color="fontTertiary" mt={1} textAlign="center">
        Your account is now 100% secure against unauthorized logins.
      </Text>
      <Button mt={2} sx={{ borderRadius: 100, px: 6 }} onClick={props.onClose}>
        Done
      </Button>

      <Button
        variant={"anchor"}
        mt={2}
        onClick={() => {
          props.onClose && props.onClose();
          setTimeout(async () => {
            await showMultifactorDialog(props.authenticatorType);
          }, 100);
        }}
      >
        Setup a fallback 2FA method
      </Button>
    </Flex>
  );
}

type Fallback2FAEnabledProps = StepComponentProps & {
  fallbackMethod: AuthenticatorType;
  primaryMethod: AuthenticatorType;
};
function Fallback2FAEnabled(props: Fallback2FAEnabledProps) {
  const { fallbackMethod, primaryMethod, onClose } = props;
  return (
    <Flex
      flexDirection={"column"}
      justifyContent="center"
      alignItems={"center"}
      mb={2}
    >
      <Fallback2FA width={200} />
      <Text variant={"heading"} fontSize="subheading" mt={2} textAlign="center">
        Fallback 2FA method enabled!
      </Text>
      <Text variant={"body"} color="fontTertiary" mt={1} textAlign="center">
        You will now receive your 2FA codes on your{" "}
        {mfaMethodToPhrase(fallbackMethod)} in case you lose access to your{" "}
        {mfaMethodToPhrase(primaryMethod)}.
      </Text>
      <Button mt={2} sx={{ borderRadius: 100, px: 6 }} onClick={onClose}>
        Done
      </Button>
    </Flex>
  );
}

function VerifyAuthenticatorForm(props: VerifyAuthenticatorFormProps) {
  const { codeHelpText, onSubmitCode, children } = props;
  const formRef = useRef<HTMLFormElement>();
  return (
    <Flex
      ref={formRef}
      as="form"
      id="2faForm"
      flexDirection="column"
      flex={1}
      sx={{ overflow: "hidden" }}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(formRef.current);
        const code = form.get("code");
        if (!code || code.toString().length !== 6) return;
        onSubmitCode(code.toString());
      }}
    >
      {children}
      <Field
        id="code"
        name="code"
        helpText={codeHelpText}
        label="Enter the 6-digit code"
        sx={{ alignItems: "center", mt: 2 }}
        required
        placeholder="010101"
        min={99999}
        max={999999}
        type="number"
        variant="clean"
        styles={{
          input: {
            width: "100%",
            fontSize: 38,
            fontFamily: "monospace",
            textAlign: "center",
          },
        }}
      />
    </Flex>
  );
}

export function mfaMethodToPhrase(method: AuthenticatorType): string {
  return method === "email"
    ? "email"
    : method === "app"
    ? "authentication app"
    : "phone number";
}
