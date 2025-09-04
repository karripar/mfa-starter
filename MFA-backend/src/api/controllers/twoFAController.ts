import CustomError from '../../classes/CustomError';
import {Request, Response, NextFunction} from 'express';
import {TokenContent, User, UserWithLevel} from '@sharedTypes/DBTypes';
import {LoginResponse, UserResponse} from '@sharedTypes/MessageTypes';
import fetchData from '../../utils/fetchData';
import OTPAuth from 'otpauth';
import twoFAModel from '../models/twoFAModel';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
// TODO: Import necessary types and models

// TODO: Define setupTwoFA function
const setupTwoFA = async (
  req: Request<{}, {}, User>,
  res: Response<{qrCodeUrl: string}>,
  next: NextFunction,
) => {
  try {
    // TODO: Register user to AUTH API
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    };

    const userResponse = await fetchData<UserResponse>(
      `${process.env.AUTH_URL}/api/v1/users`,
      options,
    )

    console.log(userResponse);
    // TODO: Generate a new 2FA secret
    const secret = new OTPAuth.Secret();

    // TODO: Create the TOTP instance
    const totp = new OTPAuth.TOTP({
      issuer: 'ElukkaAPI',
      label: userResponse.user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: secret,
    });


    // TODO: Store or update the 2FA data in the database
    await twoFAModel.create({
      email: userResponse.user.email,
      userId: userResponse.user.user_id,
      twoFactorSecret: secret.base32,
      twoFactorEnabled: true,
    })

    // TODO: Generate a QR code and send it in the response
    const imageUrl = await QRCode.toDataURL(totp.toString());

    res.json({qrCodeUrl: imageUrl});

  } catch (error) {
    next(new CustomError((error as Error).message, 500));
  }
};

// TODO: Define verifyTwoFA function
const verifyTwoFA = async (
  req: Request<{}, {}, {email: string; code: string}>,
  res: Response,
  next: NextFunction,
) => {
  const {email, code} = req.body;
  console.log(email, code);

  try {
    const twoFactorData = await twoFAModel.findOne({email});
    if (!twoFactorData || !twoFactorData.twoFactorEnabled) {
      next(new CustomError('2FA is not enabled for this user', 400));
      return;
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'ElukkaAPI',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(twoFactorData.twoFactorSecret),
    });

    const isValid = totp.validate({token: code, window: 1});

    if (isValid === null) {
      next(new CustomError('Invalid or expired 2FA code', 400));
      return;
    }

    const userResponse = await fetchData<UserWithLevel>(
      `${process.env.AUTH_URL}/api/v1/users/${twoFactorData.userId}`,
    );

    if (!userResponse) {
      next(new CustomError('User not found', 404));
      return;
    }

    const tokenContent: TokenContent = {
      user_id: userResponse.user_id,
      level_name: userResponse.level_name,
    };

    if (!process.env.JWT_SECRET) {
      next(new CustomError('JWT secret is not defined', 500));
      return;
    }

    const token = jwt.sign(tokenContent, process.env.JWT_SECRET);
    const loginResponse: LoginResponse = {
      user: userResponse,
      token,
      message: 'Login successful',
    };

    res.json(loginResponse);
  } catch (error) {
    next(new CustomError((error as Error).message, 500));
  }
};

export {setupTwoFA, verifyTwoFA};
