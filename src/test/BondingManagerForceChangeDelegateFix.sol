pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "contracts/governance/Governor.sol";
import "contracts/Controller.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/snapshots/MerkleSnapshot.sol";

interface CheatCodes {
    function roll(uint256) external;

    function prank(address) external;

    function expectRevert(bytes calldata) external;

    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData
    ) external;

    function mockCall(
        address,
        bytes calldata,
        bytes calldata
    ) external;
}

interface L2Migrator {
    function claimStake(
        address,
        uint256,
        uint256,
        bytes32[] calldata,
        address
    ) external;
}

// forge test --match-contract BondingManagerForceChangeDelegateFix --fork-url https://arbitrum-mainnet.infura.io/v3/<INFURA_KEY> -vvv --fork-block-number 8006620
contract BondingManagerForceChangeDelegateFix is DSTest {
    CheatCodes public constant CHEATS = CheatCodes(HEVM_ADDRESS);

    Governor public constant GOVERNOR = Governor(0xD9dEd6f9959176F0A04dcf88a0d2306178A736a6);
    Controller public constant CONTROLLER = Controller(0xD8E8328501E9645d16Cf49539efC04f734606ee4);
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    MerkleSnapshot public constant MERKLE_SNAPSHOT = MerkleSnapshot(0x10736ffaCe687658F88a46D042631d182C7757f7);
    L2Migrator public constant L2_MIGRATOR = L2Migrator(0x148D5b6B4df9530c7C76A810bd1Cdf69EC4c2085);

    address public constant GOVERNOR_OWNER = 0x04F53A0bb244f015cC97731570BeD26F0229da05;

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");

    // Governor update
    address[] public targets;
    uint256[] public values;
    bytes[] public datas;
    bytes20 public gitCommitHash;

    BondingManager public newBondingManagerTarget;

    event Bond(
        address indexed newDelegate,
        address indexed oldDelegate,
        address indexed delegator,
        uint256 additionalAmount,
        uint256 bondedAmount
    );

    function setUp() public {
        newBondingManagerTarget = new BondingManager(address(CONTROLLER));

        targets = [address(CONTROLLER)];
        values = [0];

        (, gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);
        datas = [
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_MANAGER_TARGET_ID,
                address(newBondingManagerTarget),
                gitCommitHash
            )
        ];

        uint256 round = 2499;
        uint256 blockNum = round * 5760;
        CHEATS.roll(blockNum);

        upgradeBondingManager();
    }

    function upgradeBondingManager() public {
        Governor.Update memory update = Governor.Update({ target: targets, value: values, data: datas, nonce: 0 });

        // Impersonate Governor owner
        CHEATS.prank(GOVERNOR_OWNER);
        GOVERNOR.stage(update, 0);
        GOVERNOR.execute(update);
    }

    function testUpgrade() public {
        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testBond() public {
        address delegator = 0x5Ec2be1aDC70Bc338471277c2dCc183b0b2C91be;
        (, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(delegator);

        uint256 initialStake = BONDING_MANAGER.transcoderTotalStake(delegateAddress);

        CHEATS.prank(delegator);
        BONDING_MANAGER.bond(10, delegateAddress);

        uint256 finalStake = BONDING_MANAGER.transcoderTotalStake(delegateAddress);

        assertEq(finalStake, initialStake + 10);
    }

    function testChangeDelegate() public {
        address delegator = 0xAcA4bD77e459b9898A0de9Ad7C1caC34fF540D0B;
        address delegate = 0x525419FF5707190389bfb5C87c375D710F5fCb0E;

        // checks if owner can change delegate
        CHEATS.prank(delegator);
        BONDING_MANAGER.bond(0, delegate);

        (, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(delegator);

        assertEq(delegateAddress, delegate);
    }

    function testClaimStake() public {
        CHEATS.mockCall(
            address(MERKLE_SNAPSHOT),
            abi.encodeWithSelector(MERKLE_SNAPSHOT.verify.selector),
            abi.encode(true)
        );

        address delegator = 0xE22d48950C88C4e8F2C5dA6c7d32D4bc9fE43Bff;
        address delegate = 0x91f19C0335BC776f4693EeB1D88765243f63e9D6;

        bytes32[] memory proof;
        CHEATS.prank(delegator);

        CHEATS.expectEmit(true, true, true, true);
        emit Bond(delegate, address(0), delegator, 500000000000000000000, 500000000000000000000);
        L2_MIGRATOR.claimStake(delegate, 500000000000000000000, 0, proof, address(0));

        (, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(delegator);

        assertEq(delegateAddress, delegate);
    }

    function testChangeDelegateByThirdParty() public {
        address delegator = 0xAcA4bD77e459b9898A0de9Ad7C1caC34fF540D0B;
        address delegate = 0x525419FF5707190389bfb5C87c375D710F5fCb0E;
        address thirdParty = 0x12336b564A71Cc4C1319bf35E87Ea45681E4D94a;

        // trying to change delegate of a delegator should revert
        CHEATS.prank(thirdParty);
        CHEATS.expectRevert(bytes("INVALID_CALLER"));
        BONDING_MANAGER.bondForWithHint(0, delegator, delegate, address(0), address(0), address(0), address(0));
    }
}
