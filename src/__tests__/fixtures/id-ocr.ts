/** Anonymized OCR fixtures modeled on real check-in scenarios (Sugumar / Likitha / Pravallika). */

export const SUGUMAR_AADHAAR_BOTH = `
Government of India
Sugumar G
DOB: 02/06/1996
MALE
9642 9251 5627
आधार
Aadhaar is proof of identity
Unique Identification Authority of India
UIDAI
Address: S/O: Gajendiran, DOOR NO 44/1, SRIRAMAPURAM, VEPPANKAL,
Pallikonda R.F., PO: Pallikonda, DIST: Vellore, Tamil Nadu - 635809
VID: 9109 3342 7051 6579
Details as on: 03/13/2025
`;

export const LIKITHA_AADHAAR_FRONT = `
Government of India
Likitha P
DOB: 01/08/2002
Female
3283 1775 3477
आधार
Aadhaar
`;

export const PRAVALLIKA_PAN = `
PAN Verification Record
PAN CARD
Government of India
PRAVALLIKA H
FEMALE
DOB 16-09-2004
Pan Number: HPZPP8626G
Powered by DigiLocker
Income Tax Department
Permanent Account Number
`;

export const VOTER_ID = `
Election Commission of India
Government of India
ELECTOR PHOTO IDENTITY CARD
Name: Test User
Father Name: Foo Bar
EPIC NO: ABC1234567
`;

export const MARKSHEET = `
CBSE
Central Board of Secondary Education
Statement of Marks
Mark Sheet
Name: Test Student
Roll No: 123456
Percentage: 85.4
Semester Result
`;

export const VEHICLE_RC = `
Certificate of Registration
Registration Certificate
Registered Owner: Test Owner
Chassis No: MA3EJKD1S00123456
Engine No: K12MN1234567
Vehicle Registration
RC Book
`;

export const DL_WITH_TRANSPORT = `
INDIAN UNION DRIVING LICENCE
Transport Department
Licence No: KA01 20210001234
Name: PAWAN DHIRAN
D.O.B: 01/07/1994
Issued on: 01/07/2014
Valid till: 01/07/2034
Class of Vehicle: LMV
Sarathi
`;

export const INDIAN_PASSPORT_BIO = `
REPUBLIC OF INDIA
PASSPORT
Type P
Country Code IND
Passport No A1234567
Surname SHARMA
Given Names RAHUL
Nationality INDIAN
Date of Birth 15/03/1995
Sex M
Place of Birth DELHI
Date of Issue 01/01/2020
Date of Expiry 01/01/2030
P<INDSHARMA<<RAHUL<<<<<<<<<<<<<<<<<<<<<<
`;

export const INDIAN_PASSPORT_WITH_ADDRESS = `${INDIAN_PASSPORT_BIO}
Address of Parents/Guardian
H No 12 MG Road Bangalore Karnataka
PIN: 560001
`;

export const FOREIGN_PASSPORT_BIO = `
UNITED STATES OF AMERICA
PASSPORT
Type P
Passport No 540012345
Surname DOE
Given Names JOHN
Nationality USA
Date of Birth 12/04/1990
P<USADOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<
`;

export const DIGILOCKER_AADHAAR_WITH_ADDRESS = `
DigiLocker
Unique Identification Authority of India
Aadhaar
Name: Test User
DOB: 1990-01-01
1234 5678 9012
Address: S/O Foo, 12 MG Road, Bangalore, Karnataka
PIN: 560001
`;
